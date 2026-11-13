import "server-only"
import { prisma } from "@/lib/prisma"

/** Messages per history page (newest first). */
const HISTORY_PAGE_SIZE = 20
/** Most recipient rows listed per message. Delivered (SENT) recipients are only tallied, never listed. */
const HISTORY_DETAIL_LIMIT = 200

/** One recipient's delivery state in the history view. Names only, never an address. */
type HistoryRecipient = { personId: number; name: string; status: string }

/** One sent message: a status tally plus the recipients that still need attention (not SENT). */
export type HistoryMessage = {
  id: number
  subject: string
  body: string
  createdAt: Date
  sentBy: string
  recipients: HistoryRecipient[]
  /** Not-SENT recipients beyond the per-message list cap (0 when the list is complete). */
  moreRecipients: number
  counts: Record<string, number>
}

/**
 * One page of a group's messages, newest first. Recipient counts come from a
 * grouped count, and only recipients that are not SENT are listed by name, so a
 * large group never loads thousands of rows per message.
 * @param groupId group id (caller has already checked access)
 * @param before only messages with an id below this (cursor from the previous page's `nextBefore`)
 * @returns the page and `nextBefore` (the cursor for older messages, or null when there are none)
 */
export async function loadGroupMessageHistory(
  groupId: number,
  before?: number,
): Promise<{ messages: HistoryMessage[]; nextBefore: number | null }> {
  const rows = await prisma.groupMessage.findMany({
    where: { groupId, ...(before ? { id: { lt: before } } : {}) },
    orderBy: { id: "desc" },
    take: HISTORY_PAGE_SIZE + 1,
    select: { id: true, subject: true, body: true, createdAt: true, sentBy: { select: { name: true } } },
  })
  const hasMore = rows.length > HISTORY_PAGE_SIZE
  const page = hasMore ? rows.slice(0, HISTORY_PAGE_SIZE) : rows
  if (page.length === 0) return { messages: [], nextBefore: null }
  const ids = page.map((m) => m.id)
  // Detail is capped per message (one query each) so a big newer message cannot starve older ones.
  const [grouped, detailPerMessage] = await Promise.all([
    prisma.groupMessageRecipient.groupBy({ by: ["messageId", "status"], where: { messageId: { in: ids } }, _count: { _all: true } }),
    Promise.all(ids.map((id) => prisma.groupMessageRecipient.findMany({
      where: { messageId: id, status: { not: "SENT" } },
      orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
      take: HISTORY_DETAIL_LIMIT,
      select: { messageId: true, status: true, person: { select: { id: true, firstName: true, lastName: true } } },
    }))),
  ])
  const detail = detailPerMessage.flat()
  const messages = page.map((m) => {
    const counts: Record<string, number> = {}
    for (const g of grouped) if (g.messageId === m.id) counts[g.status] = g._count._all
    const recipients = detail
      .filter((r) => r.messageId === m.id)
      .map((r) => ({ personId: r.person.id, name: `${r.person.firstName} ${r.person.lastName}`, status: r.status }))
    const notSent = Object.entries(counts).reduce((n, [k, c]) => (k === "SENT" ? n : n + c), 0)
    return {
      id: m.id, subject: m.subject, body: m.body, createdAt: m.createdAt,
      sentBy: m.sentBy?.name ?? "Removed user",
      recipients,
      moreRecipients: Math.max(0, notSent - recipients.length),
      counts,
    }
  })
  return { messages, nextBefore: hasMore ? page[page.length - 1].id : null }
}

/** Plain wording for a recipient status. */
export const STATUS_LABELS: Record<string, string> = {
  PENDING: "Queued",
  SENT: "Sent",
  FAILED: "Failed",
  UNKNOWN: "Unconfirmed",
}
