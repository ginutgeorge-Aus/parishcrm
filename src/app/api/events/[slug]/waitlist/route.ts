import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { Prisma } from "@/lib/generated/prisma/client"
import { encrypt, hmacEmail } from "@/lib/crypto"
import { verifyFormToken } from "@/lib/formToken"
import { verifyTurnstile } from "@/lib/turnstile"
import { rateLimit } from "@/lib/rateLimit"
import { getClientIp } from "@/lib/clientIp"
import { exceedsBodyLimit } from "@/lib/bodyLimit"
import { isRegistrationClosed } from "@/lib/eventClose"

const MAX_BODY_BYTES = 100 * 1024

const BodySchema = z.object({
  ticketTypeId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  website: z.string().max(200).optional(),
  formToken: z.string().max(200).optional(),
  // Optional Cloudflare Turnstile response — only verified when
  // TURNSTILE_SECRET_KEY is configured; otherwise ignored (off by default).
  // Same defence-in-depth gate as the sibling register endpoint.
  turnstileToken: z.string().max(2048).optional(),
})

// Event no longer accepting waitlist joins — past its close date or explicitly
// closed. Split out of POST() so the handler's early-exit gate reads as one step.
function eventCloseResponse(event: {
  date: Date | null
  endDate: Date | null
  registrationClosed: boolean
  registrationDeadline: Date | null
}): NextResponse | null {
  const closesAt = event.endDate ?? event.date
  if (closesAt && closesAt < new Date()) return NextResponse.json({ error: "Event not found" }, { status: 404 })
  if (isRegistrationClosed(event)) {
    return NextResponse.json({ error: "Registration for this event is closed." }, { status: 400 })
  }
  return null
}

// Honeypot + signed timing token + optional CAPTCHA, in that order — same
// defence-in-depth gate as the sibling register endpoint. Returns the
// rejection response, or null when all three checks pass.
async function antiBotRejection(
  website: string | undefined,
  formToken: string | undefined,
  turnstileToken: string | undefined,
  ip: string,
): Promise<NextResponse | null> {
  if (website && website.trim().length > 0) return NextResponse.json({ error: "Waitlist failed" }, { status: 400 })
  switch (verifyFormToken(formToken, Date.now())) {
    case "ok":
      break
    case "tooFast":
      return NextResponse.json({ error: "Waitlist failed" }, { status: 400 })
    default: // missing | bad | expired
      return NextResponse.json({ error: "Your session expired. Please refresh the page and try again." }, { status: 400 })
  }

  // Optional CAPTCHA: defence-in-depth, same gate as register.
  // No-op unless TURNSTILE_SECRET_KEY is configured; when enabled, a missing/
  // invalid token is rejected like the honeypot — generic error, no hint which
  // check failed.
  if (!(await verifyTurnstile(turnstileToken, ip))) {
    return NextResponse.json({ error: "Waitlist failed" }, { status: 400 })
  }
  return null
}

// Server-side parity with the public page's waitlist gate: only an
// actually sold-out ticket type may be waitlisted. `sold` counts non-CANCELLED
// quantity — the same rule as EVENT_CAPACITY_INCLUDE and the public page's
// `soldOutTypes` (capacity !== null && sold >= capacity). An unlimited type
// (capacity null) or one with spare seats is never sold out → register instead.
async function notSoldOutResponse(
  ticketTypeId: number,
  ticketType: { id: number; capacity: number | null } | undefined,
): Promise<NextResponse | null> {
  if (!ticketType) {
    return NextResponse.json({ error: "Invalid ticket type" }, { status: 400 })
  }
  const soldAgg = await prisma.registrationItem.aggregate({
    where: { ticketTypeId, registration: { paymentStatus: { not: "CANCELLED" } } },
    _sum: { quantity: true },
  })
  const sold = soldAgg._sum.quantity ?? 0
  if (ticketType.capacity === null || sold < ticketType.capacity) {
    return NextResponse.json(
      { error: "This ticket type still has seats available; please register instead." },
      { status: 400 },
    )
  }
  return null
}

// Blind index dedupes joins without decrypting: email is stored with a random
// IV so the ciphertext differs each time, but hmacEmail is deterministic. The
// @@unique(eventId, ticketTypeId, emailHash) rejects a repeat join ( A1).
async function createWaitlistEntry(
  eventId: number,
  ticketTypeId: number,
  name: string,
  email: string,
): Promise<NextResponse> {
  try {
    await prisma.waitlist.create({
      data: {
        eventId,
        ticketTypeId,
        name: name.trim(),
        email: encrypt(email),
        emailHash: hmacEmail(email),
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Already on this waitlist — treat as success so we don't leak membership
      // or surface a scary error for a harmless repeat submit.
      return NextResponse.json({ ok: true })
    }
    throw e
  }
  return NextResponse.json({ ok: true })
}

/**
 * Public, unauthenticated. Rate-limited 10 req/min/IP.
 *
 * Body (JSON): { ticketTypeId: number, name, email, website?, formToken?,
 * turnstileToken? } — `website`/`formToken`/`turnstileToken` are bot-protection
 * fields (honeypot + signed timing token + optional CAPTCHA), not waitlist data.
 *
 * Responses: `200 { ok: true }` (also returned on a harmless repeat join) |
 * `400 { error: string }` | `404` (event/ticket type not found) | `413` (body
 * too large) | `429` (rate limited).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params
  const ip = getClientIp(req)
  if (!rateLimit(`waitlist:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  if (exceedsBodyLimit(req, MAX_BODY_BYTES)) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }

  const event = await prisma.event.findUnique({
    where: { slug: params.slug },
    select: { id: true, isPublished: true, date: true, endDate: true, registrationClosed: true, registrationDeadline: true, ticketTypes: { select: { id: true, capacity: true } } },
  })
  if (!event || !event.isPublished) return NextResponse.json({ error: "Event not found" }, { status: 404 })
  const closeResponse = eventCloseResponse(event)
  if (closeResponse) return closeResponse

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const { ticketTypeId, name, email, website, formToken, turnstileToken } = parsed.data

  const botRejection = await antiBotRejection(website, formToken, turnstileToken, ip)
  if (botRejection) return botRejection

  const ticketType = event.ticketTypes.find(t => t.id === ticketTypeId)
  const soldOutError = await notSoldOutResponse(ticketTypeId, ticketType)
  if (soldOutError) return soldOutError

  return createWaitlistEntry(event.id, ticketTypeId, name, email)
}
