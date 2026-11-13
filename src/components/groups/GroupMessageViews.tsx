import Link from "next/link"
import { selectRecipients, SKIP_REASON_LABELS } from "@/lib/groupRecipients"
import { loadGroupMessageHistory, STATUS_LABELS } from "@/lib/groupMessageHistory"
import { sendGroupMessage } from "@/lib/actions/groupMessage"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatSydneyDateTime } from "@/lib/dates"
import { GroupMessageForm } from "@/components/groups/GroupMessageForm"

/**
 * Compose view shared by the dashboard and organiser pages. The caller has
 * already checked access. Shows how many members will get the email and who is
 * skipped (opted out, no address) before anything is sent.
 * @param groupId group id
 * @param historyHref link to this group's message history
 */
export async function GroupComposeView({ groupId, historyHref }: Readonly<{ groupId: number; historyHref: string }>) {
  const { recipients, skipped } = await selectRecipients(groupId)
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 text-sm">
        <p className="font-medium text-foreground">
          This email will go to {recipients.length} {recipients.length === 1 ? "member" : "members"}.
        </p>
        {skipped.length > 0 && (
          <div className="mt-2">
            <p className="text-muted-foreground">{skipped.length} will not receive it:</p>
            <ul className="mt-1 space-y-1">
              {skipped.map((s) => (
                <li key={s.personId} className="flex flex-wrap items-center gap-2">
                  <span>{s.name}</span>
                  <Badge variant="secondary">{SKIP_REASON_LABELS[s.reason]}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2"><Link href={historyHref} className="text-primary hover:underline">Sent messages</Link></p>
      </div>
      <GroupMessageForm action={sendGroupMessage.bind(null, groupId)} canSend={recipients.length > 0} />
    </div>
  )
}

/**
 * History view shared by the dashboard and organiser pages: one page of messages,
 * each with a status tally and the recipients that are not yet delivered (names
 * only, never addresses). Older messages are reached through the "Older messages" link.
 * @param groupId group id (caller has already checked access)
 * @param composeHref link to the compose page
 * @param historyHref link to this history page (base for the older-messages cursor link)
 * @param before cursor from the `before` query param (message id), if any
 */
export async function GroupHistoryView({
  groupId,
  composeHref,
  historyHref,
  before,
}: Readonly<{ groupId: number; composeHref: string; historyHref?: string; before?: number }>) {
  const { messages, nextBefore } = await loadGroupMessageHistory(groupId, before)
  return (
    <div className="space-y-4">
      <Button asChild className="w-full sm:w-auto"><Link href={composeHref}>New message</Link></Button>
      {messages.length === 0 && <p className="text-sm text-muted-foreground">No messages sent yet.</p>}
      {messages.map((m) => (
        <details key={m.id} className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer space-y-1">
            <span className="font-medium text-foreground">{m.subject}</span>
            <span className="block text-xs text-muted-foreground">
              {formatSydneyDateTime(m.createdAt)} · {m.sentBy} ·{" "}
              {Object.entries(m.counts).map(([k, n]) => `${n} ${(STATUS_LABELS[k] ?? k).toLowerCase()}`).join(", ") || "no recipients"}
            </span>
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-sm">{m.body}</p>
          {m.recipients.length > 0 && (
            <>
              <p className="mt-3 text-xs text-muted-foreground">Not confirmed as delivered:</p>
              <ul className="mt-1 space-y-1 text-sm">
                {m.recipients.map((r) => (
                  <li key={r.personId} className="flex items-center justify-between gap-2 border-t pt-1">
                    <span>{r.name}</span>
                    <Badge variant="outline">{STATUS_LABELS[r.status] ?? r.status}</Badge>
                  </li>
                ))}
              </ul>
              {m.moreRecipients > 0 && <p className="mt-1 text-xs text-muted-foreground">and {m.moreRecipients} more not shown</p>}
            </>
          )}
        </details>
      ))}
      {nextBefore !== null && historyHref && (
        <Button asChild variant="outline" className="w-full sm:w-auto"><Link href={`${historyHref}?before=${nextBefore}`}>Older messages</Link></Button>
      )}
    </div>
  )
}
