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

export async function getTopRoutes(
  days: number,
  now: Date = new Date()
): Promise<{ route: string; count: number }[]> {
  const since = utcDay(new Date(now.getTime() - days * 86_400_000))
  const rows = await prisma.routeViewDaily.groupBy({
    by: ["route"],
    where: { date: { gte: since } },
    _sum: { count: true },
    orderBy: { _sum: { count: "desc" } },
    take: 20,
  })
  return rows.map((r) => ({ route: r.route, count: r._sum.count ?? 0 }))
}
