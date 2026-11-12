"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { sendFundraiserReminders } from "@/lib/actions/fundraiser"

/**
 * Button + plain-language confirm dialog for emailing payment reminders. Counts
 * come from the server (`planReminders`); the send itself is re-validated server-side.
 *
 * @param props.fundraiserId - Fundraiser id.
 * @param props.sendable - People who still owe money and can be emailed.
 * @param props.skippedNoEmail - People who owe money but have no usable email.
 * @param props.lastSentAt - Date label of the last reminder run, or null if never.
 */
export function SendRemindersDialog({
  fundraiserId, sendable, skippedNoEmail, lastSentAt,
}: Readonly<{ fundraiserId: number; sendable: number; skippedNoEmail: number; lastSentAt: string | null }>) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, start] = useTransition()

  /** Send reminders and show the outcome in the dialog. */
  function send() {
    setError(null)
    start(async () => {
      const res = await sendFundraiserReminders(fundraiserId)
      if ("error" in res) { setError(res.error); return }
      setDone(`Sent ${res.sent} reminder${res.sent === 1 ? "" : "s"}${res.failed ? `, ${res.failed} failed` : ""}.`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setDone(null) } }}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Send reminders</Button></DialogTrigger>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader><DialogTitle>Send payment reminders</DialogTitle></DialogHeader>
        {done ? (
          <>
            <p className="text-sm text-foreground">{done}</p>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-foreground">
              {sendable === 0
                ? "Nobody can be reminded right now."
                : `This will email ${sendable} ${sendable === 1 ? "person" : "people"} who still owe money.`}
            </p>
            {skippedNoEmail > 0 && (
              <p className="text-muted-foreground">
                {skippedNoEmail} {skippedNoEmail === 1 ? "person owes" : "people owe"} money but {skippedNoEmail === 1 ? "has" : "have"} no email we can use, so they will be skipped.
              </p>
            )}
            <p className="text-muted-foreground">
              {lastSentAt ? `Reminders were last sent on ${lastSentAt}.` : "No reminders have been sent yet."}
            </p>
            <FormFeedback state={{ error }} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={send} disabled={pending || sendable === 0}>
                {pending ? "Sending…" : "Send reminders"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
