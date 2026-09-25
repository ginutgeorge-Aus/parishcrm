import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { toCents, centsToNumber } from "@/lib/formatting"
import { hmacEmail } from "@/lib/crypto"
import { verifyFormToken } from "@/lib/formToken"
import { validateAnswer, isQuestionApplicable, isAttendeeScoped, type CustomQuestion, type CustomAnswer } from "@/lib/eventQuestions"
import { verifyTurnstile } from "@/lib/turnstile"
import { computeFamilyWaiver } from "@/lib/eventWaiver"
import { computeTieredTotal } from "@/lib/eventTieredPricing"
import { EVENT_CAPACITY_INCLUDE } from "@/lib/eventCapacityInclude"

// Thrown during per-attendee answer validation — caught before the transaction
// and returned as a 400 to avoid nested error handling inside the txn.
class AnswerError extends Error {}

// Upper bound on tickets/customAnswers map key counts.
const MAX_MAP_KEYS = 50

// Absolute cap on total attendees in one registration, independent of any
// per-ticket-type capacity. Per-type quantity is capped at 100 and the
// map at MAX_MAP_KEYS=50 keys, but those are Decimal(10,2)-overflow guards
// — for a ticket type with capacity: null (a supported unlimited
// config), they're the ONLY ceiling: one public POST could otherwise request
// up to 50 * 100 = 5000 attendees, each writing an Attendee row (+ an
// encrypted answers blob when attendee-scoped questions exist) in one txn.
const MAX_ATTENDEES_PER_REGISTRATION = 100

// Merge ticketTypeId map keys that `parseInt` to the same numeric id.
// The Zod key regex (`^\d+$`) already rejects non-digit alias forms ("+5",
// " 5", "5.0"), but digit-only aliases like "5" and "05" both pass it and
// still resolve to the same ticket type — without this merge each becomes its
// own line item, checked against the SAME un-incremented capacity snapshot,
// which defeats both the pre-check below and the in-txn recheck for a
// deterministic single-POST oversell. Canonical key = String(numeric id).
function canonicalizeTickets(tickets: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, qty] of Object.entries(tickets)) {
    const canonicalKey = String(parseInt(key, 10))
    out[canonicalKey] = (out[canonicalKey] ?? 0) + qty
  }
  return out
}

// Same alias-merge for the per-ticket-type arrays (attendeeNames /
// attendeeAnswers) — concatenates the aliased entries' arrays so a merged
// ticket-quantity still has a name/answer for every unit.
function canonicalizeByTicketTypeId<V>(map: Record<string, V[]> | undefined): Record<string, V[]> {
  if (!map) return {}
  const out: Record<string, V[]> = {}
  for (const [key, arr] of Object.entries(map)) {
    const canonicalKey = String(parseInt(key, 10))
    out[canonicalKey] = [...(out[canonicalKey] ?? []), ...arr]
  }
  return out
}

const BodySchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(255),
  phone: z.string().max(50).optional(),
  // Per-type quantity bound: unbounded quantities overflow the
  // Decimal(10,2) totalAmount column → unhandled 500 on this public route.
  // Key must be digit-only: a non-digit key like "+5", " 5", or "5.0"
  // still `parseInt`s to a real ticketTypeId but is a DISTINCT map key from
  // "5" — each key becomes its own line item checked against the same
  // un-incremented capacity snapshot, a deterministic single-POST oversell.
  // This regex layer rejects the non-digit forms; canonicalizeByTicketTypeId
  // below merges the remaining digit-only aliases ("5" vs "05") that still
  // share a numeric value.
  tickets: z.record(z.string().regex(/^\d+$/, "Invalid ticket type"), z.number().int().min(0).max(100)),
  // One name per ticket unit, keyed by ticketTypeId (string). Bounded like the
  // tickets map; per-name length capped to keep the JSON payload small.
  attendeeNames: z.record(z.string().regex(/^\d+$/, "Invalid ticket type"), z.array(z.string().max(120)).max(100)).optional(),
  customAnswers: z.record(
    z.string().max(100),
    z.union([z.string().max(500), z.array(z.string().max(200)).max(50), z.array(z.boolean()).max(50), z.boolean()]),
  ).optional(),
  // Per-attendee custom question answers, keyed by ticketTypeId string.
  // Inner array is parallel to attendeeNames[ticketTypeId] (one map per attendee).
  // Cap per-name string lengths to keep stored encrypted payloads bounded.
  attendeeAnswers: z.record(
    z.string().regex(/^\d+$/, "Invalid ticket type"),
    z.array(z.record(
      z.string().max(100),
      z.union([z.string().max(2000), z.array(z.string().max(200)).max(50), z.array(z.boolean()).max(50), z.boolean()])
    )).max(100),
  ).optional(),
  // Bot protection: honeypot — a hidden field real users never fill —
  // and a signed timing token issued when the form was rendered.
  website: z.string().max(200).optional(),
  formToken: z.string().max(200).optional(),
  // Optional Cloudflare Turnstile response — only verified when
  // TURNSTILE_SECRET_KEY is configured; otherwise ignored (off by default).
  turnstileToken: z.string().max(2048).optional(),
})

// The inferred type of the prisma.event.findUnique result with the include
// used below — shared by validateAndPriceRegistration, persistRegistration,
// and createEventRegistration so all three agree on the event shape.
export type EventWithTickets = NonNullable<
  Awaited<ReturnType<typeof fetchEventWithTickets>>
>

export function fetchEventWithTickets(slug: string) {
  return prisma.event.findUnique({
    where: { slug },
    include: EVENT_CAPACITY_INCLUDE,
  })
}

interface PricedItem {
  ticketTypeId: number
  quantity: number
  unitPrice: number
  attendeeNames: string[]
  perAttendeeAnswers: (Record<string, CustomAnswer> | undefined)[]
}

interface CapacityCheck {
  ticketTypeId: number
  quantity: number
  name: string
}

// Everything needed to persist a registration, computed authoritatively
// server-side. `email` is plaintext here (encrypted at persist time).
export interface PricedRegistration {
  firstName: string
  lastName: string
  email: string
  emailHash: string
  phone?: string
  normalizedAnswers?: Record<string, CustomAnswer>
  items: PricedItem[]
  totalAmount: number
  waivedCount: number
  capacityChecks: CapacityCheck[]
}

// Validates + prices a registration request against an already-fetched event.
// Pure w.r.t. persistence — never touches the database. Every early-return
// error shape (`{ ok: false, status, error }`) matches createEventRegistration's
// pre-extraction behavior exactly.
export async function validateAndPriceRegistration(
  event: EventWithTickets,
  rawBody: unknown,
  ip: string,
): Promise<{ ok: true; priced: PricedRegistration } | { ok: false; status: number; error: string }> {
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0].message }

  const {
    firstName, lastName, email, phone, customAnswers,
    tickets: rawTickets, attendeeNames: rawAttendeeNames, attendeeAnswers: rawAttendeeAnswers,
  } = parsed.data
  // Blind index of the email — computed once and reused for the idempotency
  // lookup, the stored emailHash, and the confirmation-mail
  // throttle key.
  const emailHashValue = hmacEmail(email)

  // Bot protection: a filled honeypot means a script that fills every
  // field. Return the generic 400 — never hint that the honeypot was the cause.
  if (parsed.data.website && parsed.data.website.trim().length > 0) {
    return { ok: false, status: 400, error: "Registration failed" }
  }
  // Timing token: reject missing/forged/too-fast/stale submissions.
  switch (verifyFormToken(parsed.data.formToken, Date.now())) {
    case "ok":
      break
    case "tooFast":
      return { ok: false, status: 400, error: "Registration failed" }
    default: // missing | bad | expired
      return {
        ok: false,
        status: 400,
        error: "Your session expired. Please refresh the page and try again.",
      }
  }

  // Optional CAPTCHA: defence-in-depth. No-op unless TURNSTILE_SECRET_KEY
  // is configured; when enabled, a missing/invalid token is rejected like the
  // honeypot — generic 400, no hint which check failed.
  if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) {
    return { ok: false, status: 400, error: "Registration failed" }
  }

  // Bound map key counts — unbounded records can write multi-MB JSON rows.
  // Checked on the RAW (pre-canonicalization) maps: this bounds payload size,
  // which is a function of how many keys the client sent, not how many
  // distinct ticket types they resolve to.
  if (Object.keys(rawTickets).length > MAX_MAP_KEYS) {
    return { ok: false, status: 400, error: "Too many ticket entries" }
  }
  if (customAnswers && Object.keys(customAnswers).length > MAX_MAP_KEYS) {
    return { ok: false, status: 400, error: "Too many answers" }
  }
  if (rawAttendeeNames && Object.keys(rawAttendeeNames).length > MAX_MAP_KEYS) {
    return { ok: false, status: 400, error: "Too many ticket entries" }
  }
  if (rawAttendeeAnswers && Object.keys(rawAttendeeAnswers).length > MAX_MAP_KEYS) {
    return { ok: false, status: 400, error: "Too many answers" }
  }

  // Canonicalize ticketTypeId keys by numeric value BEFORE any
  // pricing/capacity logic runs, so aliased keys ("5" vs "05") can never
  // exist as separate line items past this point.
  const tickets = canonicalizeTickets(rawTickets)
  const attendeeNames = canonicalizeByTicketTypeId(rawAttendeeNames)
  const attendeeAnswers = canonicalizeByTicketTypeId(rawAttendeeAnswers)

  // Only accept answers keyed to this event's actual custom questions.
  // Symmetric across order- and attendee-scoped answers: both reject an
  // unknown key with 400 rather than silently dropping it.
  const questionIds = new Set(
    Array.isArray(event.customQuestions)
      ? (event.customQuestions as { id?: unknown }[]).map((q) => String(q?.id))
      : []
  )
  if (customAnswers) {
    for (const key of Object.keys(customAnswers)) {
      if (!questionIds.has(key)) {
        return { ok: false, status: 400, error: "Unknown question" }
      }
    }
  }
  if (attendeeAnswers) {
    for (const perTicket of Object.values(attendeeAnswers)) {
      for (const answerMap of perTicket) {
        for (const key of Object.keys(answerMap)) {
          if (!questionIds.has(key)) {
            return { ok: false, status: 400, error: "Unknown question" }
          }
        }
      }
    }
  }

  // Build the set of selected ticket-type names for applicability filtering.
  const selectedTicketNames = new Set(
    Object.entries(tickets)
      .filter(([, q]) => q > 0)
      .map(([idStr]) => event.ticketTypes.find((t) => t.id === parseInt(idStr, 10))?.name)
      .filter((n): n is string => Boolean(n))
  )

  // Split questions into order-scoped and attendee-scoped. Order-scoped answers
  // are validated here against the full selected-ticket-name set; attendee-scoped
  // answers are validated per-item below against that item's single ticket type.
  const allQuestions = Array.isArray(event.customQuestions)
    ? (event.customQuestions as unknown as CustomQuestion[])
    : []
  const orderQuestions = allQuestions.filter(q => q && typeof q.id === "string" && !isAttendeeScoped(q))
  const attendeeQuestions = allQuestions.filter(q => q && typeof q.id === "string" && isAttendeeScoped(q))

  // Validate order-scoped answers server-side — client JS can be bypassed, so
  // this is the only trustworthy gate. Consent answers are replaced by a
  // server-stamped ISO timestamp so the stored value is auditable and
  // tamper-resistant. Non-applicable questions (ticket-type targeted but ticket
  // not selected) are skipped.
  let normalizedAnswers: Record<string, CustomAnswer> | undefined
  {
    const out: Record<string, CustomAnswer> = {}
    for (const q of orderQuestions) {
      if (!isQuestionApplicable(q, selectedTicketNames)) continue
      const result = validateAnswer(q, customAnswers?.[q.id] as CustomAnswer | undefined)
      if (!result.ok) return { ok: false, status: 400, error: result.error }
      if (result.value !== undefined) out[q.id] = result.value
    }
    normalizedAnswers = Object.keys(out).length > 0 ? out : undefined
  }

  // Validate at least 1 ticket, and no more than the absolute per-registration cap.
  const totalTickets = Object.values(tickets).reduce((s, n) => s + n, 0)
  if (totalTickets === 0) return { ok: false, status: 400, error: "Select at least one ticket" }
  if (totalTickets > MAX_ATTENDEES_PER_REGISTRATION) {
    return { ok: false, status: 400, error: `A single registration is limited to ${MAX_ATTENDEES_PER_REGISTRATION} attendees` }
  }

  // Validate capacity and build line items. The pre-transaction check below is a
  // cheap early reject only; the authoritative re-check happens inside the
  // Serializable transaction to close the TOCTOU window.
  // Accumulate in integer cents — `unitPrice * quantity` in float dollars drifts
  // (e.g. 3.33 * 7 = 23.310000000000002) and would store an imprecise total in
  // the Decimal(10,2) column.
  let totalCents = 0
  const items: PricedItem[] = []
  const capacityChecks: CapacityCheck[] = []

  for (const [ticketTypeIdStr, quantity] of Object.entries(tickets)) {
    if (quantity === 0) continue
    const ticketTypeId = parseInt(ticketTypeIdStr, 10)
    const tt = event.ticketTypes.find(t => t.id === ticketTypeId)
    if (!tt) return { ok: false, status: 400, error: "Invalid ticket type" }

    // Require a non-empty name for every ticket unit of this type (length == quantity).
    // Keep each kept name's ORIGINAL index: filtering blanks shifts
    // positions, but attendeeAnswers is sent parallel to the unfiltered names
    // array, so answers must be looked up by original index — otherwise a blank
    // in the middle maps every later attendee's answers to the wrong person.
    const keptNames = (attendeeNames?.[ticketTypeIdStr] ?? [])
      .map((n, origIdx) => ({ name: n.trim(), origIdx }))
      .filter(({ name }) => name.length > 0)
    if (keptNames.length !== quantity) {
      return { ok: false, status: 400, error: `Enter a name for each ${tt.name} ticket` }
    }
    const trimmedNames = keptNames.map(({ name }) => name)

    // Validate attendee-scoped questions against this item's single ticket type.
    // Applicability uses the attendee's own ticket-type name, not the full set.
    const ttNameSet = new Set([tt.name])
    const perAttendeeAnswers: (Record<string, CustomAnswer> | undefined)[] = []
    try {
      for (let idx = 0; idx < keptNames.length; idx++) {
        const raw = attendeeAnswers?.[ticketTypeIdStr]?.[keptNames[idx].origIdx] ?? {}
        const out: Record<string, CustomAnswer> = {}
        for (const q of attendeeQuestions) {
          if (!isQuestionApplicable(q, ttNameSet)) continue
          const result = validateAnswer(q, raw[q.id] as CustomAnswer | undefined)
          if (!result.ok) throw new AnswerError(result.error)
          if (result.value !== undefined) out[q.id] = result.value
        }
        perAttendeeAnswers.push(Object.keys(out).length > 0 ? out : undefined)
      }
    } catch (e) {
      if (e instanceof AnswerError) {
        return { ok: false, status: 400, error: e.message }
      }
      throw e
    }

    if (tt.capacity !== null) {
      const sold = tt.registrationItems.reduce((s, i) => s + i.quantity, 0)
      if (sold + quantity > tt.capacity) {
        return { ok: false, status: 400, error: `${tt.name} tickets sold out` }
      }
    }
    // Always queue this ticket type for the in-txn authoritative re-check
    //, even when its snapshot capacity is null (unlimited). An admin
    // can change an unlimited type to a finite capacity between this pricing
    // snapshot and the transaction commit — omitting null-capacity
    // types here meant persistRegistration never re-read them and a
    // concurrent null-to-finite change was oversold.
    capacityChecks.push({ ticketTypeId, quantity, name: tt.name })

    // Snapshot the per-item price from the same integer-cents source as the
    // total below, so the stored unitPrice can never disagree with totalAmount
    // by a float-rounding artefact.
    const unitPrice = centsToNumber(toCents(tt.price))
    totalCents += toCents(tt.price) * quantity
    items.push({ ticketTypeId, quantity, unitPrice, attendeeNames: trimmedNames, perAttendeeAnswers })
  }
  // Total: tiered family schedule (whole-headcount lookup) XOR the family fee
  // waiver. The two are mutually exclusive at the event level (event action
  // guard), so only one branch runs. RegistrationItem.unitPrice snapshots stay
  // the true ticket price either way — the schedule only sets the total.
  let waivedCount = 0
  let totalAmount: number
  if (event.tieredPricingEnabled) {
    const attendeeCount = items.reduce((s, it) => s + it.quantity, 0)
    // Defensive element-type check: a corrupt JSON blob like ["60","x"]
    // would pass Array.isArray and reach the cents math. Only trust an array of
    // finite numbers; anything else prices as an empty schedule (→ over-max).
    const raw = event.familyPricingTiers
    const tiers = Array.isArray(raw) && raw.every((n) => typeof n === "number" && Number.isFinite(n))
      ? (raw as number[])
      : []
    const tiered = computeTieredTotal(tiers, attendeeCount)
    if (!tiered.ok) {
      return {
        ok: false,
        status: 400,
        error: `This event allows a maximum of ${tiered.maxAttendees} registrants per registration`,
      }
    }
    totalAmount = centsToNumber(tiered.totalCents)
  } else {
    // Family fee waiver: free the surplus counted-ticket units
    // after the threshold, cheapest first. Reduces the total only — per-item
    // unitPrice snapshots keep the true ticket price. Excluded types never
    // participate.
    const waiverLines = items.map((it) => {
      const tt = event.ticketTypes.find((t) => t.id === it.ticketTypeId)!
      return {
        unitPriceCents: toCents(tt.price),
        quantity: it.quantity,
        countsTowardWaiver: tt.countsTowardWaiver,
      }
    })
    const { freeCount, discountCents } = computeFamilyWaiver(waiverLines, {
      enabled: event.familyWaiverEnabled,
      threshold: event.familyWaiverThreshold,
    })
    waivedCount = freeCount
    totalAmount = centsToNumber(totalCents - discountCents)
  }

  return {
    ok: true,
    priced: {
      firstName,
      lastName,
      email,
      emailHash: emailHashValue,
      phone,
      normalizedAnswers,
      items,
      totalAmount,
      waivedCount,
      capacityChecks,
    },
  }
}
