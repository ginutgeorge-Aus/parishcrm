import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { fmtAUD } from "@/lib/formatting"
import { APP_TIMEZONE, APP_LOCALE } from "@/lib/appConfig"
import { encrypt } from "@/lib/crypto"
import { rateLimit } from "@/lib/rateLimit"
import { sendRegistrationConfirmationEmail } from "@/lib/email"
import { buildIcs, googleCalendarUrl } from "@/lib/ics"
import type { Organizer } from "@/lib/eventOrganizers"
import { getChurchSettings } from "@/lib/churchSettings"
import type { PaymentStatus } from "@/lib/generated/prisma/enums"
import type { EventWithTickets, PricedRegistration } from "@/lib/eventRegistrationPricing"

// Discriminated result the API route maps to a NextResponse. Transport concerns
// (per-IP rate limit, body-size cap, req.json()) stay in the route; this
// module owns the full validation → transaction → confirmation-email pipeline so
// it is unit-testable without a Next request and reusable by an admin flow.
export type RegisterResult =
  | { ok: true; ref: string; duplicate?: boolean }
  | { ok: false; status: number; error: string }

// Thrown inside the registration transaction when a capacity re-check fails.
class SoldOutError extends Error {}

// Thrown inside the registration transaction when a selected ticket type was
// deleted after validation but before this transaction's in-txn re-read
//. Distinct from SoldOutError/`cur.capacity === null` (unlimited) —
// `cur === null` means the row is gone, not that there's no limit; letting it
// fall through as "unlimited" would reach registrationItem.create with a
// dangling ticketTypeId and surface as an unhandled FK-constraint error.
class TicketUnavailableError extends Error {}

// Prisma maps Postgres serialization failures / deadlocks (Serializable txns)
// to error code P2034. Retrying the whole transaction is the correct response.
function isSerializationConflict(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2034"
  )
}

const MAX_TX_ATTEMPTS = 3

// Idempotency window. A second registration for the same event + email
// within this window is treated as an accidental double-submit (double-click,
// back-then-resubmit, or a network retry after a committed-but-lost response)
// and returns the original ref instead of creating a duplicate row. Kept short:
// those resubmits are near-instant, so a genuine later re-registration (e.g. a
// second household member) is still accepted after the window.
const DEDUPE_WINDOW_MS = 10 * 60 * 1000

export interface PaymentFields {
  paymentStatus: PaymentStatus
  paymentRef?: string
}

// Runs the Serializable txn (idempotency dedupe + authoritative capacity
// re-check + create) then fires the confirmation email. Email's bank-details
// block is shown only when paymentStatus === PENDING && totalAmount > 0.
export async function persistRegistration(
  event: EventWithTickets,
  priced: PricedRegistration,
  payment: PaymentFields,
): Promise<RegisterResult> {
  const { firstName, lastName, email, emailHash: emailHashValue, phone, normalizedAnswers, items, totalAmount, capacityChecks } = priced

  // Serializable transaction with an in-txn capacity re-check. Two concurrent
  // last-seat registrations can no longer both pass: the second commit fails the
  // re-check (sold out) or hits a serialization conflict (P2034) and retries.
  let publicToken: string
  let isDuplicate = false
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Idempotency: if this event+email already registered within the
          // dedupe window, return the original ref instead of a second row. Inside
          // the Serializable txn so a concurrent double-click serialises — the 2nd
          // attempt hits a serialization conflict (P2034 → retry) and then sees the
          // 1st committed row here. CANCELLED prior regs don't block re-registering.
          const existing = await tx.registration.findFirst({
            where: {
              eventId: event.id,
              emailHash: emailHashValue,
              paymentStatus: { not: "CANCELLED" },
              createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
            },
            orderBy: { createdAt: "desc" },
            select: { publicToken: true },
          })
          if (existing) return { publicToken: existing.publicToken, duplicate: true }

          for (const c of capacityChecks) {
            // Re-read capacity INSIDE the txn, not the pre-txn snapshot: an admin
            // lowering a ticket-type's capacity while this request is in flight
            // must not be oversold against the old, higher limit ( TOCTOU).
            const cur = await tx.ticketType.findUnique({
              where: { id: c.ticketTypeId },
              select: { capacity: true },
            })
            // Distinguish "type removed" from "capacity cleared to null
            // (unlimited)" — the former must reject cleanly here
            // instead of falling through to registrationItem.create's FK.
            if (!cur) throw new TicketUnavailableError(c.name)
            if (cur.capacity == null) continue
            const agg = await tx.registrationItem.aggregate({
              // Authoritative re-check — exclude CANCELLED here too.
              where: {
                ticketTypeId: c.ticketTypeId,
                registration: { paymentStatus: { not: "CANCELLED" } },
              },
              _sum: { quantity: true },
            })
            const sold = agg._sum.quantity ?? 0
            if (sold + c.quantity > cur.capacity) throw new SoldOutError(c.name)
          }
          const reg = await tx.registration.create({
            data: {
              eventId: event.id,
              // Opaque, unguessable ref — defeats REG-1..N enumeration of the
              // public success page. 6 bytes = 48 bits, @unique-enforced.
              publicToken: "REG-" + randomBytes(6).toString("hex").toUpperCase(),
              firstName,
              lastName,
              // email + phone are PII submitted by unauthenticated public users;
              // encrypt at rest like Person.email.
              email: encrypt(email),
              // Blind index so the person-export matches this registration to a
              // member by an indexed lookup, not a full-table decrypt scan.
              emailHash: emailHashValue,
              phone: phone ? encrypt(phone) : null,
              // customAnswers can hold sensitive PII (dietary/medical/emergency
              // contact) — encrypt the whole serialized map at rest like the
              // family-update payload. Stored as a JSON string scalar.
              customAnswers: normalizedAnswers ? encrypt(JSON.stringify(normalizedAnswers)) : undefined,
              totalAmount,
              paymentStatus: payment.paymentStatus,
              paymentRef: payment.paymentRef ?? null,
            },
          })
          for (const item of items) {
            await tx.registrationItem.create({
              data: {
                registrationId: reg.id,
                ticketTypeId: item.ticketTypeId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                attendees: {
                  create: item.attendeeNames.map((name, idx) => ({
                    name,
                    answers: item.perAttendeeAnswers[idx]
                      ? encrypt(JSON.stringify(item.perAttendeeAnswers[idx]))
                      : undefined,
                  })),
                },
              },
            })
          }
          return { publicToken: reg.publicToken, duplicate: false }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
      publicToken = result.publicToken
      isDuplicate = result.duplicate
      break
    } catch (e) {
      if (e instanceof SoldOutError) {
        return { ok: false, status: 400, error: `${e.message} tickets sold out` }
      }
      if (e instanceof TicketUnavailableError) {
        return { ok: false, status: 400, error: `${e.message} is no longer available` }
      }
      if (isSerializationConflict(e)) {
        if (attempt < MAX_TX_ATTEMPTS) continue
        return { ok: false, status: 409, error: "Registration is busy, please try again" }
      }
      throw e
    }
  }

  // Accidental resubmit within the window: the original already committed
  // and its confirmation email already sent — return the original ref, no new row
  // and no duplicate email.
  if (isDuplicate) return { ok: true, ref: publicToken, duplicate: true }

  // Confirmation email — fire-and-forget. A send failure is logged and
  // never blocks or fails the registration that already committed.
  //
  // Recipient-keyed throttle: this endpoint is public and unauthenticated,
  // so cap confirmation sends per recipient address (5/hr) to stop it being used
  // as a spam relay / mail bomb against a chosen victim. Over the cap → skip the
  // send; the registration still succeeds. (The per-IP cap in the route bounds the POST.)
  if (rateLimit(`regmail:${emailHashValue}`, 5, 3_600_000)) {
    try {
      // Calendar artifacts only for one-off events with a concrete date.
      let ics: { content: string; filename: string } | undefined
      let gcalUrl: string | undefined
      let dateLabel: string | undefined
      if (event.date) {
        const start = event.date
        const end = event.endDate ?? new Date(start.getTime() + 2 * 60 * 60 * 1000)
        ics = {
          content: buildIcs({
            uid: publicToken,
            title: event.title,
            description: event.description ?? undefined,
            location: event.location ?? undefined,
            start,
            end,
          }),
          filename: "event.ics",
        }
        gcalUrl = googleCalendarUrl({
          title: event.title,
          details: event.description ?? undefined,
          location: event.location ?? undefined,
          start,
          end,
        })
        dateLabel = start.toLocaleString(APP_LOCALE, {
          weekday: "short", day: "numeric", month: "short", year: "numeric",
          hour: "numeric", minute: "2-digit", timeZone: APP_TIMEZONE,
        })
      }
      const { name: churchName } = await getChurchSettings()
      await sendRegistrationConfirmationEmail(email, {
        churchName,
        eventTitle: event.title,
        eventDateLabel: dateLabel,
        eventLocation: event.location ?? undefined,
        registrantName: `${firstName} ${lastName}`,
        items: items.map((it) => {
          const tt = event.ticketTypes.find((t) => t.id === it.ticketTypeId)
          return { quantity: it.quantity, ticketName: tt?.name ?? "Ticket", attendeeNames: it.attendeeNames }
        }),
        totalLabel: fmtAUD(totalAmount),
        waivedCount: priced.waivedCount,
        payment: payment.paymentStatus === "PENDING" && totalAmount > 0
          ? { bankBsb: event.bankBsb, bankAccount: event.bankAccount, reference: publicToken }
          : undefined,
        googleCalendarUrl: gcalUrl,
        organizers: Array.isArray(event.organizers)
          ? (event.organizers as unknown as Organizer[])
          : undefined,
        ics,
      })
    } catch (e) {
      // Log the error message only — a raw nodemailer/SMTP error object can
      // serialize the recipient address and message content into
      // log-reader-visible container logs (same rule as logger.ts).
      console.error("Registration confirmation email failed:", e instanceof Error ? e.message : String(e))
    }
  }

  return { ok: true, ref: publicToken }
}
