"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { getVenueRequestPreview, sendVenueUsageRequest, type VenueRequestPreview } from "@/lib/actions/venueUsage"
import { approveVenueMonth, withdrawVenueApproval } from "@/lib/actions/venueBookings"
import { formatSydneyDate } from "@/lib/dates"
import { formatHours, formatMonthLabel } from "@/lib/venueUsage"

/**
 * Narrow an action result to what `DeleteConfirmButton` understands (errors only).
 * @param r action result
 */
function errorOnly(r: { error: string } | { success: string } | undefined): { error: string } | undefined {
  return r && "error" in r ? r : undefined
}

/**
 * "Request invoice" panel: choose a month, preview the email, approve the automatic send
 * (current month only), or confirm and send by hand.
 * @param props the month to show first
 */
export function InvoiceRequestPanel({ defaultMonth }: Readonly<{ defaultMonth: string }>) {
  const [reqMonth, setReqMonth] = useState(defaultMonth)
  const [preview, setPreview] = useState<VenueRequestPreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [result, setResult] = useState<{ error?: string; success?: string } | undefined>()
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await getVenueRequestPreview(reqMonth)
      if (cancelled) return
      if ("error" in p) {
        setPreview(null)
        setLoadError(p.error)
      } else {
        setLoadError(null)
        setPreview(p)
      }
    })()
    return () => { cancelled = true }
  }, [reqMonth, reloadKey])

  const alreadySent = preview?.last?.status === "SUCCESS"

  /** Send the request now for the month whose preview is shown (resend flag set when one already went out). */
  async function send() {
    if (!preview) return { error: "Preview is still loading." }
    const r = await sendVenueUsageRequest(preview.month, alreadySent)
    setResult(r)
    setReloadKey((k) => k + 1)
    return errorOnly(r)
  }

  /** Approve the automatic send for the month whose preview is shown. */
  async function approve() {
    if (!preview) return { error: "Preview is still loading." }
    const r = await approveVenueMonth(preview.month)
    setResult(r)
    setReloadKey((k) => k + 1)
    return errorOnly(r)
  }

  /** Withdraw the shown month's approval so the job will not send it. */
  async function withdraw() {
    if (!preview) return
    const r = await withdrawVenueApproval(preview.month)
    setResult(r)
    setReloadKey((k) => k + 1)
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-medium">Request invoice</h2>
      <div className="space-y-1.5">
        <Label htmlFor="vu-req-month">Month to invoice</Label>
        <Input
          id="vu-req-month" type="month" value={reqMonth} className="w-44"
          onChange={(e) => { if (e.target.value) { setReqMonth(e.target.value); setPreview(null); setLoadError(null); setResult(undefined) } }}
        />
      </div>

      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}

      {preview && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {preview.rowCount} confirmed {preview.rowCount === 1 ? "booking" : "bookings"},{" "}
            {formatHours(preview.totalHours)} for {formatMonthLabel(preview.month)}.
          </p>
          {preview.warnings.length > 0 && (
            <ul role="alert" className="list-disc space-y-0.5 rounded-md border border-destructive/40 bg-muted p-3 pl-7 text-sm text-destructive">
              {preview.warnings.map((w) => <li key={w} className="break-words">{w}</li>)}
            </ul>
          )}
          {preview.last?.status && (
            <p className="text-sm" aria-live="polite">
              Last request:{" "}
              <Badge variant={preview.last.status === "SUCCESS" ? "default" : "destructive"}>
                {preview.last.status === "SUCCESS" ? "Sent" : "Failed"}
              </Badge>{" "}
              {preview.last.sentAt && <span className="text-muted-foreground">{new Date(preview.last.sentAt).toLocaleString()}</span>}
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">To</dt>
            <dd className="break-all">{preview.to || "Not set"}</dd>
            {preview.cc && (<><dt className="text-muted-foreground">CC</dt><dd className="break-all">{preview.cc}</dd></>)}
            <dt className="text-muted-foreground">Replies go to</dt>
            <dd className="break-all">{preview.replyTo || "Not set"}</dd>
            <dt className="text-muted-foreground">Subject</dt>
            <dd className="break-words">{preview.subject}</dd>
          </dl>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-sm">
            {preview.text}
          </pre>
          {preview.isCurrentMonth && (
            <div className="space-y-2 rounded-md border p-3">
              <h3 className="text-sm font-medium">Automatic send</h3>
              {preview.approval ? (
                <>
                  <p className="text-sm">
                    Approved by {preview.approval.approvedBy ?? "a former user"} on{" "}
                    {formatSydneyDate(new Date(preview.approval.approvedAt))}; will be sent on {preview.autoSendLabel}.
                  </p>
                  <Button variant="outline" onClick={() => void withdraw()}>Withdraw approval</Button>
                </>
              ) : (
                <DeleteConfirmButton
                  title="Approve automatic send?"
                  description={
                    <span className="block max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">{preview.text}</span>
                  }
                  triggerLabel={`Approve automatic send on ${preview.autoSendLabel}`}
                  triggerVariant="default"
                  triggerSize="default"
                  triggerClassName="h-auto min-h-9 whitespace-normal text-left"
                  disabled={!preview.canApprove}
                  disabledReason="Complete every Sunday (confirmed or cancelled), clear all Requested dates and confirm at least one date to enable this."
                  confirmLabel="Approve"
                  pendingLabel="Approving…"
                  onConfirm={approve}
                />
              )}
            </div>
          )}
          {preview.autoSent && preview.last?.status === "SUCCESS" && (
            <p className="text-sm text-muted-foreground">Sent automatically.</p>
          )}
          {preview.blockedReason ? (
            <p className="text-sm text-muted-foreground">{preview.blockedReason}</p>
          ) : (
            <DeleteConfirmButton
              title={alreadySent ? "Send this request again?" : "Send invoice request?"}
              description={
                alreadySent
                  ? `A request for ${formatMonthLabel(preview.month)} was already sent. This emails ${preview.to} again.`
                  : `This emails ${preview.to} asking for the ${formatMonthLabel(preview.month)} invoice.`
              }
              triggerLabel={alreadySent ? "Send again" : "Send request"}
              triggerVariant="default"
              triggerSize="default"
              triggerClassName=""
              confirmLabel="Send"
              pendingLabel="Sending…"
              onConfirm={send}
            />
          )}
          {result && <FormFeedback state={result} />}
        </div>
      )}
    </section>
  )
}
