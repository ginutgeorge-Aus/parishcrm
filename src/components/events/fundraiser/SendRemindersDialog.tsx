"use client"

import { useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { getReminderPlan, sendFundraiserReminders } from "@/lib/actions/fundraiser"

type Plan = { sendable: number; skippedNoEmail: number; lastSentAt: string | null }

/**
 * Button + plain-language confirm dialog for emailing payment reminders. Counts
 * are loaded from the server (`getReminderPlan`) each time the dialog opens, so
 * the page never decrypts recipient emails just to render; the send itself is
 * re-validated server-side.
 *
 * @param props.fundraiserId - Fundraiser id.
 */
export function SendRemindersDialog({ fundraiserId }: Readonly<{ fundraiserId: number }>) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, startLoad] = useTransition()
  const [pending, start] = useTransition()
  const latestLoad = useRef(0)

  /**
   * Load the preview counts shown in the dialog. Only the latest load may set
   * state: a slow response from an earlier open is ignored, so it cannot
   * overwrite newer counts.
   */
  function loadPlan() {
    setPlan(null)
    const seq = ++latestLoad.current
    startLoad(async () => {
      try {
        const res = await getReminderPlan(fundraiserId)
        if (seq !== latestLoad.current) return
        if ("error" in res) setError(res.error)
        else setPlan(res)
      } catch {
        if (seq !== latestLoad.current) return
        setError("Could not load reminder details. Please try again.")
      }
    })
  }

  /** Send reminders and show the outcome in the dialog. */
  function send() {
    setError(null)
    start(async () => {
      let res: Awaited<ReturnType<typeof sendFundraiserReminders>>
      try {
        res = await sendFundraiserReminders(fundraiserId)
      } catch {
        setError("Could not send reminders. Please try again.")
        return
      }
      if ("error" in res) { setError(res.error); return }
      setDone(`Sent ${res.sent} reminder${res.sent === 1 ? "" : "s"}${res.failed ? `, ${res.failed} failed` : ""}${res.skippedRecent ? `, ${res.skippedRecent} skipped (reminded in the last 10 minutes)` : ""}.`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setDone(null); loadPlan() } }}>
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
            {plan && <PlanSummary plan={plan} />}
            {!plan && loading && <p className="text-muted-foreground">Loading…</p>}
            <FormFeedback state={{ error }} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={send} disabled={pending || !plan || plan.sendable === 0}>
                {pending ? "Sending…" : "Send reminders"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Plain-language preview of a reminder run.
 * @param props.plan - Counts and last-sent date label from `getReminderPlan`.
 */
function PlanSummary({ plan: { sendable, skippedNoEmail, lastSentAt } }: Readonly<{ plan: Plan }>) {
  return (
    <>
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
    </>
  )
}
