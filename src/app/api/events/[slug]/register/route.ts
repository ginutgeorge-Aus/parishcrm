import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rateLimit"
import { getClientIp } from "@/lib/clientIp"
import { exceedsBodyLimit } from "@/lib/bodyLimit"
import { createEventRegistration } from "@/lib/eventRegistration"

// Reject oversized bodies before req.json() buffers them into the heap.
// A legit registration payload is a few KB; this cap leaves generous headroom.
const MAX_BODY_BYTES = 100 * 1024

/**
 * Public, unauthenticated. Rate-limited 10 req/min/IP.
 *
 * Body (JSON): { firstName, lastName, email, phone?, tickets: { [ticketTypeId]: qty },
 * attendeeNames?: { [ticketTypeId]: string[] }, customAnswers?: { [questionId]: string | string[] | boolean },
 * attendeeAnswers?: { [ticketTypeId]: Array<{ [questionId]: string | string[] | boolean }> },
 * website?, formToken?, turnstileToken? } — see `BodySchema` in `@/lib/eventRegistration`
 * for full bounds. `website`/`formToken`/`turnstileToken` are bot-protection fields, not
 * registration data.
 *
 * Responses: `200 { ref: string }` | `400/404/409/... { error: string }` | `413` (body too
 * large) | `429` (rate limited).
 *
 * Thin transport wrapper: per-IP rate limit + body-size cap + parse,
 * then delegate the full validation/transaction/email pipeline to the reusable,
 * unit-testable core in @/lib/eventRegistration and map its result to a response.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params
  const ip = getClientIp(req)
  // 10 requests per IP per minute via the shared in-memory limiter.
  if (!rateLimit(`register:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // Reject before parsing — don't buffer a multi-MB body to then fail Zod.
  if (exceedsBodyLimit(req, MAX_BODY_BYTES)) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const result = await createEventRegistration(params.slug, body, ip)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  // (SECURITY): a dedupe hit matches only on eventId + emailHash within a
  // 10-minute window — no proof this caller is the original submitter. Echoing
  // result.ref here would hand anyone who resubmits a victim's email the
  // victim's publicToken (the success-page secret AND the check-in QR
  // credential). Never disclose it to a duplicate submitter; the original
  // submitter already has it from their own first response + confirmation email.
  if (result.duplicate) {
    return NextResponse.json({ duplicate: true })
  }
  return NextResponse.json({ ref: result.ref, duplicate: false })
}
