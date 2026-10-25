"use client"

import { useEffect, useState } from "react"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { getBookingRequestPreview, sendBookingRequest, type BookingRequestPreview } from "@/lib/actions/venueBookings"
import { formatTime12, formatUsageDate, ymdToUtcDate } from "@/lib/venueUsage"

/**
 * Narrow an action result to what `DeleteConfirmButton` understands (errors only).
 * @param r action result
 */
function errorOnly(r: { error: string } | { success: string } | undefined): { error: string } | undefined {
  return r && "error" in r ? r : undefined
}

/**
 * "Send booking request" panel: tick the new REQUESTED dates, preview the email (new dates plus
 * already-booked dates), then send. Dates already asked about show "asked on <date>".
 * @param props `dataVersion` bumps whenever the booking list changed (forces a refetch);
 *   `onSent` runs after a successful send so the parent can refresh its list
 */
export function BookingRequestPanel({ dataVersion = 0, onSent }: Readonly<{ dataVersion?: number; onSent?: () => void }>) {
  const [preview, setPreview] = useState<BookingRequestPreview | null>(null)
  const [ticked, setTicked] = useState<number[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [result, setResult] = useState<{ error?: string; success?: string } | undefined>()
  const [wanted, setWanted] = useState<number[] | undefined>(undefined) // undefined = server default (all ticked)
  const [reloadKey, setReloadKey] = useState(0)

  // Reload whenever the ticked set changes (or after a send). A stale response is dropped.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await getBookingRequestPreview(wanted)
      if (cancelled) return
      if ("error" in p) {
        setLoadError(p.error)
        return
      }
      setLoadError(null)
      setPreview(p)
      setTicked(p.selectedIds)
    })()
    return () => { cancelled = true }
  }, [wanted, reloadKey, dataVersion])

  /**
   * Tick or untick one candidate and reload the preview.
   * @param id candidate row id
   */
  function toggle(id: number) {
    const next = ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id]
    setTicked(next)
    setWanted(next)
  }

  /** Send the request for the ticked dates and refresh the preview. */
  async function send() {
    const r = await sendBookingRequest(ticked)
    setResult(r)
    setWanted(undefined)
    setReloadKey((k) => k + 1)
    if (r && "success" in r) onSent?.()
    return errorOnly(r)
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-medium">Send booking request</h2>
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
      {preview && (
        <div className="space-y-3">
          {preview.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No new dates to request.</p>
          ) : (
            <ul className="space-y-1">
              {preview.candidates.map((c) => {
                const label = formatUsageDate(ymdToUtcDate(c.date))
                return (
                  <li key={c.id}>
                    <label className="flex min-h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox" className="size-5 shrink-0 accent-primary" aria-label={label}
                        checked={ticked.includes(c.id)} onChange={() => toggle(c.id)}
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {label}, {formatTime12(c.startTime)} – {formatTime12(c.endTime)}
                        {c.purpose && <span className="text-muted-foreground"> ({c.purpose})</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {preview.asked.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Already asked</h3>
              <ul className="text-sm text-muted-foreground">
                {preview.asked.map((a) => (
                  <li key={a.id}>
                    {formatUsageDate(ymdToUtcDate(a.date))}: asked on {formatUsageDate(ymdToUtcDate(a.askedOn))}
                  </li>
                ))}
              </ul>
            </div>
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
          {preview.blockedReason ? (
            <p className="text-sm text-muted-foreground">{preview.blockedReason}</p>
          ) : (
            <DeleteConfirmButton
              title="Send booking request?"
              description={`This emails ${preview.to} asking to book ${ticked.length} ${ticked.length === 1 ? "date" : "dates"}.`}
              triggerLabel="Send request"
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
