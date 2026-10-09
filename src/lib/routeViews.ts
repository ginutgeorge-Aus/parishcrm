import { prisma } from "@/lib/prisma"

function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|c[a-z0-9]{20,31})$/i

/**
 * Collapse record-id path segments (numeric, UUID, cuid) to `[id]` so the daily
 * counter keeps one row per route template, not one per record viewed.
 * e.g. `/people/ckabc...xyz/edit` -> `/people/[id]/edit`.
 */
export function normalizeRoute(path: string): string {
  return path
    .split("/")
    .map((seg) => (ID_SEGMENT.test(seg) ? "[id]" : seg))
    .join("/")
}

/**
 * Fire-and-forget aggregate counter. NEVER throws — a view counter must never
slow or break a page render. No userId/session is recorded by design.
 * The raw path is normalised to its route template before counting.
 */
export function recordRouteView(rawRoute: string, now: Date = new Date()): void {
  const route = normalizeRoute(rawRoute)
  const date = utcDay(now)
  void prisma.routeViewDaily
    .upsert({
      where: { route_date: { route, date } },
      update: { count: { increment: 1 } },
      create: { route, date, count: 1 },
    })
    .catch(() => {})
}

/**
 * Top routes by view count over the last `days` days. Stored routes are
 * re-normalised and merged on read so rows written before normalisation
 * (e.g. `/people/42`) fold into their `/people/[id]` template immediately,
 * preserving totals, instead of lingering until retention deletes them.
 *
 * @param days - lookback window in days
 * @param now - reference time (injectable for tests)
 * @returns up to 20 routes with summed counts, highest first
 */
export async function getTopRoutes(
  days: number,
  now: Date = new Date()
): Promise<{ route: string; count: number }[]> {
  const since = utcDay(new Date(now.getTime() - days * 86_400_000))
  // No `take` here: the top 20 must be chosen AFTER merging legacy per-record rows.
  const rows = await prisma.routeViewDaily.groupBy({
    by: ["route"],
    where: { date: { gte: since } },
    _sum: { count: true },
  })
  const merged = new Map<string, number>()
  for (const r of rows) {
    const route = normalizeRoute(r.route)
    merged.set(route, (merged.get(route) ?? 0) + (r._sum.count ?? 0))
  }
  return [...merged]
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
}
