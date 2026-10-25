"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteVenueUsage, setVenueUsageStatus, type VenueMutationResult } from "@/lib/actions/venueUsage"
import { formatSydneyDate } from "@/lib/dates"
import {
  durationHours, formatHours, formatTime12, formatUsageDate, validateTimeRange, ymdToUtcDate,
  type VenueBookingStatusValue,
} from "@/lib/venueUsage"
import type { VenueUsageRowView } from "./VenueUsageClient"

const STATUS_LABEL: Record<VenueBookingStatusValue, string> = {
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
}
const STATUS_VARIANT: Record<VenueBookingStatusValue, "default" | "outline" | "destructive"> = {
  REQUESTED: "outline",
  CONFIRMED: "default",
  CANCELLED: "destructive",
}
/** Error text the status action returns when every selected row was already in the target status. */
const NOTHING_TO_CHANGE = "No bookings to change"

/**
 * Human duration of a row, or "" when its times are invalid.
 * @param r row with start and end times
 */
function rowHours(r: { startTime: string; endTime: string }): string {
  return validateTimeRange(r.startTime, r.endTime) ? "" : formatHours(durationHours(r.startTime, r.endTime))
}

/**
 * Outcome line of the last bulk action: success (with any warning), information
 * ("nothing to change") or a real error.
 * @param props the last result
 */
function ResultMessage({ result }: Readonly<{ result: VenueMutationResult }>) {
  if ("success" in result) {
    return (
      <>
        <p role="status" className="text-sm text-muted-foreground">{result.success}</p>
        {result.warning && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-muted p-2 text-sm text-destructive">
            {result.warning}
          </p>
        )}
      </>
    )
  }
  if (result.error === NOTHING_TO_CHANGE) {
    return <p role="status" className="text-sm text-muted-foreground">{result.error}</p>
  }
  return <p role="alert" className="text-sm text-destructive">{result.error}</p>
}

/**
 * Booking list for one month with selection, bulk "Mark confirmed" / "Cancel",
 * per-row Edit/Cancel/Delete and the "email the venue about this cancellation?" dialog.
 * @param props rows, edit callback and a callback that receives every mutation result
 */
export function BookingList({ rows, onEdit, onResult }: Readonly<{
  rows: VenueUsageRowView[]
  onEdit: (r: VenueUsageRowView) => void
  onResult: (r: VenueMutationResult | undefined) => void
}>) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [cancelIds, setCancelIds] = useState<number[] | null>(null)
  const [message, setMessage] = useState<VenueMutationResult | undefined>()
  const [pending, startTransition] = useTransition()

  /**
   * Toggle one row's selection.
   * @param id VenueUsage id
   */
  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Run a status change, record and forward the result, refresh on success.
   * @param ids VenueUsage ids
   * @param status target status
   * @param emailVenue whether to email the venue (cancel only)
   */
  function run(ids: number[], status: "CONFIRMED" | "CANCELLED", emailVenue?: boolean) {
    startTransition(async () => {
      const r = status === "CANCELLED"
        ? await setVenueUsageStatus(ids, status, { emailVenue: !!emailVenue })
        : await setVenueUsageStatus(ids, status)
      setMessage(r)
      onResult(r)
      setCancelIds(null)
      setSelected(new Set())
      router.refresh()
    })
  }

  const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id)
  return (
    <div className="space-y-3">
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
          <span className="font-medium">{ids.length} selected</span>
          <Button size="sm" disabled={pending} onClick={() => run(ids, "CONFIRMED")}>Mark confirmed</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setCancelIds(ids)}>Cancel</Button>
        </div>
      )}
      {message && <ResultMessage result={message} />}
      <ul className="divide-y">
        {rows.map((r) => {
          const label = formatUsageDate(ymdToUtcDate(r.date))
          return (
            <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <Checkbox
                  className="mt-0.5 size-5 after:-inset-2.5"
                  aria-label={`Select ${label}`}
                  checked={selected.has(r.id)}
                  onCheckedChange={() => toggle(r.id)}
                />
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{label}</span>
                    <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {r.status === "REQUESTED" && r.bookingRequestedAt && (
                      <span className="text-xs text-muted-foreground">
                        asked on {formatSydneyDate(new Date(r.bookingRequestedAt))}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatTime12(r.startTime)} – {formatTime12(r.endTime)} ({rowHours(r)})
                  </p>
                  {r.purpose && <p className="text-sm [overflow-wrap:anywhere]">{r.purpose}</p>}
                  {r.notes && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.notes}</p>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>Edit</Button>
                {r.status !== "CANCELLED" && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => setCancelIds([r.id])}>Cancel</Button>
                )}
                <DeleteConfirmButton
                  title="Delete this booking?"
                  description={`${label} will be removed from the log.`}
                  onConfirm={async () => {
                    const res = await deleteVenueUsage(r.id)
                    onResult(res)
                    return "error" in res ? res : undefined
                  }}
                />
              </div>
            </li>
          )
        })}
      </ul>
      <AlertDialog open={cancelIds !== null} onOpenChange={(open) => { if (!open) setCancelIds(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel {cancelIds?.length ?? 0} {cancelIds?.length === 1 ? "date" : "dates"}?
            </AlertDialogTitle>
            <AlertDialogDescription>Email venue about this cancellation?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-wrap">
            <AlertDialogCancel>Keep bookings</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={() => cancelIds && run(cancelIds, "CANCELLED", false)}>
              Cancel without emailing
            </AlertDialogAction>
            <AlertDialogAction onClick={() => cancelIds && run(cancelIds, "CANCELLED", true)}>
              Cancel and email venue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
