import "server-only"
import { prisma } from "@/lib/prisma"

/** Messages listed per class (newest first). */
const HISTORY_LIMIT = 20

/** One sent parent email with its delivery tally. Never carries an address. */
export type SsHistoryMessage = {
  id: number
  subject: string
  body: string
  createdAt: Date
  sentBy: string
  counts: Record<string, number>
}

/**
 * The class's most recent parent emails, newest first, each with a per-status
 * recipient count from one grouped query.
 * @param classId the class (caller has already checked access)
 */
export async function loadSsMessageHistory(classId: number): Promise<SsHistoryMessage[]> {
  const rows = await prisma.sundaySchoolMessage.findMany({
    where: { classId },
    orderBy: { id: "desc" },
    take: HISTORY_LIMIT,
    select: { id: true, subject: true, body: true, createdAt: true, sentBy: { select: { name: true } } },
  })
  if (rows.length === 0) return []
  const grouped = await prisma.sundaySchoolMessageRecipient.groupBy({
    by: ["messageId", "status"],
    where: { messageId: { in: rows.map((m) => m.id) } },
    _count: { _all: true },
  })
  return rows.map((m) => {
    const counts: Record<string, number> = {}
    for (const g of grouped) if (g.messageId === m.id) counts[g.status] = g._count._all
    return { id: m.id, subject: m.subject, body: m.body, createdAt: m.createdAt, sentBy: m.sentBy?.name ?? "Removed user", counts }
  })
}
