"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog"
import { sendPaymentReminders } from "@/lib/actions/registration"
import type { SendRemindersResult } from "@/lib/actions/registration"
import { fmtAUD } from "@/lib/formatting"
import { formatSydneyDate } from "@/lib/dates"

export type PendingReminderRow = {
  registrationId: number
  name: string
  email: string | null
  amountDue: number
  lastRemindedAt: string | null
}

export function SendPaymentRemindersClient({
  eventId, eventTitle, rows,
}: { eventId: number; eventTitle: string; rows: PendingReminderRow[] }) {
  const emailable = rows.filter((r) => r.email)
  // Server rejects a batch over MAX_BATCH outright (MAX_REMINDER_BATCH_SIZE), so
  // never pre-select — or let the operator select — more than it will accept.
  const MAX_BATCH = 200
  // Pre-check emailable rows not yet reminded (capped); already-reminded start unchecked.
  const initial = new Set(
    emailable.filter((r) => !r.lastRemindedAt).slice(0, MAX_BATCH).map((r) => r.registrationId)
  )
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(initial)
  const [message, setMessage] = useState(
    `Our records show your registration for ${eventTitle} is not yet paid. ` +
    `Please complete your payment using the link below. Thank you.`
  )
  const [result, setResult] = useState<SendRemindersResult | null>(null)
  const [isSending, startSend] = useTransition()

  if (rows.length === 0) return null

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_BATCH) next.add(id) // don't let selection exceed the server cap
      return next
    })
  }

  function handleSend() {
    setResult(null)
    startSend(async () => {
      const payload = Array.from(selected).map((registrationId) => ({ registrationId }))
      const res = await sendPaymentReminders(eventId, payload, message)
      setResult(res)
      // Clear the selection once a send completes so the just-reminded rows can't
      // be resent on a second click; the page revalidates and reopening reflects
      // the new lastRemindedAt.
      if (!("error" in res)) setSelected(new Set())
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Email unpaid registrants</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Email unpaid registrants — {eventTitle}</DialogTitle>
        </DialogHeader>

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {rows.map((r) => (
            <label key={r.registrationId} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(r.registrationId)}
                disabled={!r.email}
                onCheckedChange={() => toggle(r.registrationId)}
              />
              <span className="flex-1">
                {r.name}{" "}
                <span className="text-muted-foreground">
                  {r.email ?? "(no email)"} · {fmtAUD(r.amountDue)}
                  {r.lastRemindedAt ? ` · reminded ${formatSydneyDate(new Date(r.lastRemindedAt))}` : ""}
                </span>
              </span>
            </label>
          ))}
        </div>

        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} rows={5} aria-label="Message" />
        <p className="text-xs text-muted-foreground">A link to the event page is added to the end of every email.</p>
        {selected.size >= MAX_BATCH && (
          <p className="text-xs text-muted-foreground">
            Up to {MAX_BATCH} per send. Send this batch, then reopen to remind the rest.
          </p>
        )}

        {result && "error" in result ? (
          <p role="alert" className="text-sm text-destructive">{result.error}</p>
        ) : result ? (
          <p role="status" className="text-sm">Sent {result.sent} · Failed {result.failed}</p>
        ) : null}

        <DialogFooter>
          <Button onClick={handleSend} disabled={isSending || selected.size === 0}>
            {isSending ? "Sending…" : `Send to ${selected.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
