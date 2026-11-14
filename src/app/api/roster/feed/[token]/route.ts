import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rateLimit"
import { rateKeyFromRequest } from "@/lib/clientIp"
import { buildRosterIcs, type RosterAssignment } from "@/lib/rosterIcs"
import { ROSTER_FEED_TOKEN_RE, hashRosterFeedToken, rosterFeedTokenMatches } from "@/lib/rosterFeed"
import { PRODUCT_NAME } from "@/lib/settingsConstants"

export const dynamic = "force-dynamic"

/** Days of past services kept in the feed, so a calendar app still shows last week. */
const PAST_DAYS = 30
/** Hard cap on events in one feed (about two years of weekly services). */
const MAX_EVENTS = 500
const DAY_MS = 86_400_000

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })

/**
 * Personal roster calendar feed (text/calendar). The secret token in the path
 * is the only credential: bad, unknown or rotated tokens all return the same
 * 404, and the token is never logged. Declined assignments are left out.
 * Content is the person's own services only: title, role, time, place, status.
 * @param req the request (used for the per-client rate-limit key)
 * @param ctx route context holding the token path param
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  if (!rateLimit(`rosterFeed:${rateKeyFromRequest(req)}`, 60, 60_000)) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } })
  }
  const raw = (await ctx.params).token
  const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw
  if (!ROSTER_FEED_TOKEN_RE.test(token)) return NOT_FOUND()

  const row = await prisma.rosterFeedToken.findUnique({
    where: { tokenHash: hashRosterFeedToken(token) },
    select: { tokenHash: true, person: { select: { id: true, firstName: true, lastName: true, archivedAt: true } } },
  })
  if (!row || row.person.archivedAt || !rosterFeedTokenMatches(token, row.tokenHash)) return NOT_FOUND()

  const since = new Date(Date.now() - PAST_DAYS * DAY_MS)
  const rows = await prisma.rosterAssignment.findMany({
    where: { personId: row.person.id, status: { not: "DECLINED" }, slot: { service: { endsAt: { gte: since } } } },
    orderBy: { slot: { service: { startsAt: "asc" } } },
    take: MAX_EVENTS,
    select: {
      id: true,
      status: true,
      slot: { select: { role: { select: { name: true } }, service: { select: { title: true, startsAt: true, endsAt: true, location: true } } } },
    },
  })
  const events: RosterAssignment[] = rows.map((a) => ({
    id: String(a.id),
    title: `${a.slot.service.title} (${a.slot.role.name})`,
    start: a.slot.service.startsAt,
    end: a.slot.service.endsAt,
    location: a.slot.service.location,
    description: a.status === "CONFIRMED" ? "Confirmed" : "Awaiting your confirmation",
  }))
  const body = buildRosterIcs(events, { calendarName: `${PRODUCT_NAME} roster: ${row.person.firstName} ${row.person.lastName}` })
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  })
}
