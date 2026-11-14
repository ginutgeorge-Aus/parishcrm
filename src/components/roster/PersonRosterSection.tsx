import { prisma } from "@/lib/prisma"
import { sydneyToday, utcYmd } from "@/lib/dates"
import { PersonRosterCard } from "@/components/roster/PersonRosterCard"

/**
 * Server wrapper for the person page roster card: loads this person's
 * upcoming and current unavailable ranges (past ones drop off) and whether a
 * calendar link exists. Render only for roster managers.
 * @param props the person id
 */
export async function PersonRosterSection({ personId }: Readonly<{ personId: number }>) {
  const [rows, feed] = await Promise.all([
    prisma.personUnavailability.findMany({
      where: { personId, endDate: { gte: sydneyToday() } },
      orderBy: { startDate: "asc" },
      take: 100,
      select: { id: true, startDate: true, endDate: true },
    }),
    prisma.rosterFeedToken.findUnique({ where: { personId }, select: { id: true } }),
  ])
  return (
    <PersonRosterCard
      personId={personId}
      rows={rows.map((r) => ({ id: r.id, from: utcYmd(r.startDate), to: utcYmd(r.endDate) }))}
      hasFeed={feed !== null}
    />
  )
}
