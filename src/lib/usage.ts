import { prisma } from "@/lib/prisma"
import { dormantAreas, weekBuckets } from "@/lib/usageFeatures"

type WeeklyPoint = { label: string; count: number }
export type UsageSummary = {
  days: number
  adoption: { resourceType: string; count: number }[]
  activeUsers: number
  weeklyActiveUsers: WeeklyPoint[]
  weeklyTrend: WeeklyPoint[]
  dormant: string[]
}

export async function getUsageSummary(days: number, now: Date = new Date()): Promise<UsageSummary> {
  const windowStart = new Date(now.getTime() - days * 86400_000)

  // The dashboard measures HUMAN activity. Background/cron audit writes carry a
  // null userId (System actor, since AuditLog.userId became nullable) — exclude
  // them from every aggregate, else a daily sweep adds a phantom "System" active
  // user and inflates adoption/trend counts.
  const HUMAN = { userId: { not: null } }

  // Adoption by feature area, desc. Served by [resourceType, action, createdAt].
  const adoptionRows = await prisma.auditLog.groupBy({
    by: ["resourceType"],
    where: { ...HUMAN, createdAt: { gte: windowStart } },
    _count: { _all: true },
    orderBy: { _count: { resourceType: "desc" } },
  })
  const adoption = adoptionRows
    .map((r) => ({
      resourceType: r.resourceType,
      count: r._count._all,
    }))
    .sort((a, b) => b.count - a.count)

  // Distinct active users in the window. groupBy(userId).length = distinct count.
  const activeRows = await prisma.auditLog.groupBy({
    by: ["userId"],
    where: { ...HUMAN, createdAt: { gte: windowStart } },
  })
  const activeUsers = activeRows.length

  // 12 weekly buckets: per week, distinct users (groupBy) + total mutations (count).
  // 24 index-served queries, all cheap — avoids raw SQL (banned) and loading rows.
  const buckets = weekBuckets(now, 12)
  const weeklyActiveUsers: WeeklyPoint[] = []
  const weeklyTrend: WeeklyPoint[] = []
  for (const b of buckets) {
    const where = { ...HUMAN, createdAt: { gte: b.start, lt: b.end } }
    const [users, total] = await Promise.all([
      prisma.auditLog.groupBy({ by: ["userId"], where }),
      prisma.auditLog.count({ where }),
    ])
    weeklyActiveUsers.push({ label: b.label, count: users.length })
    weeklyTrend.push({ label: b.label, count: total })
  }

  return {
    days,
    adoption,
    activeUsers,
    weeklyActiveUsers,
    weeklyTrend,
    dormant: dormantAreas(adoption.map((a) => a.resourceType)),
  }
}
