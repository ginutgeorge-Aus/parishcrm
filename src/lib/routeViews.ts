import { prisma } from "@/lib/prisma"

function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// Fire-and-forget aggregate counter. NEVER throws — a view counter must never
// slow or break a page render. No userId/session is recorded by design.
export function recordRouteView(route: string, now: Date = new Date()): void {
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
  const since = utcDay(new Date(now.getTime() - days * 86400_000))
  const rows = await prisma.routeViewDaily.groupBy({
    by: ["route"],
    where: { date: { gte: since } },
    _sum: { count: true },
    orderBy: { _sum: { count: "desc" } },
    take: 20,
  })
  return rows.map((r) => ({ route: r.route, count: r._sum.count ?? 0 }))
}
