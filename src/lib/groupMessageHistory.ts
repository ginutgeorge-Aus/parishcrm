import "server-only"
import { prisma } from "@/lib/prisma"

/** Messages shown on the history page (newest first). */
export const HISTORY_LIMIT = 50

/** One recipient's delivery state in the history view. Names only, never an address. */
export type HistoryRecipient = { personId: number; name: string; status: string }

/** One sent message with its per-recipient delivery state. */
export type HistoryMessage = {
  id: number
  subject: string
  body: string
  createdAt: Date
  sentBy: string
  recipients: HistoryRecipient[]
  counts: Record<string, number>
}

/**
 * A group's recent messages with per-recipient status, newest first.
 * @param groupId group id (caller has already checked access)
 */
export async function loadGroupMessageHistory(groupId: number): Promise<HistoryMessage[]> {
  const rows = await prisma.groupMessage.findMany({
    where: { groupId },
    orderBy: { id: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true, subject: true, body: true, createdAt: true,
      sentBy: { select: { name: true } },
      recipients: {
        orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
        select: { status: true, person: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  })
  return rows.map((m) => {
    const counts: Record<string, number> = {}
    for (const r of m.recipients) counts[r.status] = (counts[r.status] ?? 0) + 1
    return {
      id: m.id, subject: m.subject, body: m.body, createdAt: m.createdAt,
      sentBy: m.sentBy?.name ?? "Removed user",
      recipients: m.recipients.map((r) => ({ personId: r.person.id, name: `${r.person.firstName} ${r.person.lastName}`, status: r.status })),
      counts,
    }
  })
}

/** Plain wording for a recipient status. */
export const STATUS_LABELS: Record<string, string> = {
  PENDING: "Queued",
  SENT: "Sent",
  FAILED: "Failed",
  UNKNOWN: "Unconfirmed",
}
