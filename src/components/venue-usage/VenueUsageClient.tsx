"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import {
  createVenueUsage, updateVenueUsage, addAllSundays, type VenueMutationResult,
} from "@/lib/actions/venueUsage"
import {
  VENUE_BOOKING_STATUSES, defaultStatusForDate, formatHours, formatMonthLabel,
  totalHours, ymdToUtcDate, type VenueBookingStatusValue,
} from "@/lib/venueUsage"
import { BookingList } from "./BookingList"
import { BookingRequestPanel } from "./BookingRequestPanel"
import { InvoiceRequestPanel } from "./InvoiceRequestPanel"
import { CalendarLinkBox } from "./CalendarLinkBox"

export type VenueUsageRowView = {
  id: number
  date: string
  startTime: string
  endTime: string
  status: VenueBookingStatusValue
  purpose: string | null
  notes: string | null
  /** ISO date-time the row was included in a booking request to the venue, if any. */
  bookingRequestedAt: string | null
}

type Props = {
  month: string
  today: string
  nextSunday: string
  defaultRequestMonth: string
  rows: VenueUsageRowView[]
  /** Absolute committee-calendar link; null when none exists or the viewer may not see it. */
  calendarUrl: string | null
  /** True for ADMIN only: may create or reset the calendar link. */
  canResetCalendar: boolean
}

const STATUS_LABEL: Record<VenueBookingStatusValue, string> = {
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
}
const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

type FormState = {
  id: number | null
  date: string
  startTime: string
  endTime: string
  status: VenueBookingStatusValue
  purpose: string
  notes: string
}

/** Blank add-form: next Sunday 17:00-20:00; status REQUESTED for future dates, CONFIRMED otherwise. */
function blankForm(nextSunday: string, today: string): FormState {
  return {
    id: null, date: nextSunday, startTime: "17:00", endTime: "20:00",
    status: defaultStatusForDate(nextSunday, today), purpose: "", notes: "",
  }
}

/**
 * Venue usage screen: month picker, booking list, add/edit form, the booking-request and
 * "Request invoice" panels and the committee calendar link box.
 * @param props the selected month, server "today" values, that month's rows and the calendar link state
 */
export function VenueUsageClient({ month, today, nextSunday, defaultRequestMonth, rows, calendarUrl, canResetCalendar }: Readonly<Props>) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(() => blankForm(nextSunday, today))
  const [formState, setFormState] = useState<{ error?: string; success?: string } | undefined>()
  const [approvalCleared, setApprovalCleared] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const [seenMonth, setSeenMonth] = useState(month)
  const [pending, startTransition] = useTransition()

  // The approval-cleared notice belongs to the month it was raised in.
  if (seenMonth !== month) {
    setSeenMonth(month)
    setApprovalCleared(false)
  }

  const confirmedHours = totalHours(rows.map((r) => ({ ...r, date: ymdToUtcDate(r.date) })))
  const otherCount = rows.filter((r) => r.status !== "CONFIRMED").length

  /**
   * After a successful mutation: bump the data version so the request panels refetch, and
   * remember if the month's approval was cleared so the re-approve notice shows.
   * @param r mutation result from any booking action
   */
  function handleResult(r: VenueMutationResult | undefined) {
    if (r && "success" in r) {
      setDataVersion((v) => v + 1)
      if (r.approvalCleared) setApprovalCleared(true)
    }
  }

  /** Add every Sunday of the selected month using the form's times and purpose. */
  function addAll() {
    startTransition(async () => {
      const result = await addAllSundays({ month, startTime: form.startTime, endTime: form.endTime, purpose: form.purpose })
      setFormState(result)
      handleResult(result)
      if (result && "success" in result) router.refresh()
    })
  }

  /**
   * Update one form field.
   * @param key field name
   * @param value new value
   */
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  /**
   * Set the form date; while adding, re-suggest the status for that date.
   * @param date new date as YYYY-MM-DD (may be empty while typing)
   */
  function onDateChange(date: string) {
    // Only re-suggest the status while adding; an edit keeps the chosen status.
    setForm((f) => ({ ...f, date, ...(f.id === null && date ? { status: defaultStatusForDate(date, today) } : {}) }))
  }

  /**
   * Create or update the booking from the form, then reset the form and follow the saved month.
   * @param e form submit event
   */
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const input = {
      date: form.date, startTime: form.startTime, endTime: form.endTime,
      status: form.status, purpose: form.purpose, notes: form.notes,
    }
    startTransition(async () => {
      const result = form.id === null ? await createVenueUsage(input) : await updateVenueUsage(form.id, input)
      setFormState(result)
      handleResult(result)
      if (result && "success" in result) {
        setForm(blankForm(nextSunday, today))
        // Show the month of the saved date so the new row is visible.
        if (form.date.slice(0, 7) !== month) router.push(`/venue-usage?month=${form.date.slice(0, 7)}`)
      }
    })
  }

  /**
   * Load a row into the form for editing and scroll to it.
   * @param r the row to edit
   */
  function startEdit(r: VenueUsageRowView) {
    setFormState(undefined)
    setForm({ ...r, purpose: r.purpose ?? "", notes: r.notes ?? "" })
    document.getElementById("venue-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="venue-month">Month</Label>
            <Input
              id="venue-month"
              type="month"
              value={month}
              onChange={(e) => e.target.value && router.push(`/venue-usage?month=${e.target.value}`)}
              className="w-44"
            />
          </div>
          <p className="text-sm" aria-live="polite">
            <span className="font-medium">{formatHours(confirmedHours)}</span> confirmed in {formatMonthLabel(month)}
            {otherCount > 0 && (
              <span className="text-muted-foreground"> ({otherCount} requested or cancelled not counted)</span>
            )}
          </p>
        </div>

        {approvalCleared && (
          <p role="status" className="rounded-md border bg-muted p-2 text-sm text-foreground">
            Approval cleared — dates changed, please re-approve.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No bookings logged for this month.</p>
        ) : (
          <BookingList rows={rows} onEdit={startEdit} onResult={handleResult} />
        )}
      </section>

      <section id="venue-form" className="scroll-mt-20 space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-medium">{form.id === null ? "Add a booking" : "Edit booking"}</h2>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="vu-date">Date</Label>
            <Input id="vu-date" type="date" required value={form.date} onChange={(e) => onDateChange(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vu-status">Status</Label>
            <select
              id="vu-status"
              className={SELECT_CLASS}
              value={form.status}
              onChange={(e) => set("status", e.target.value as VenueBookingStatusValue)}
            >
              {VENUE_BOOKING_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vu-start">Start</Label>
            <Input id="vu-start" type="time" required value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vu-end">End</Label>
            <Input id="vu-end" type="time" required value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="vu-purpose">Purpose (optional)</Label>
            <Input
              id="vu-purpose" maxLength={200} placeholder="e.g. Sunday service"
              value={form.purpose} onChange={(e) => set("purpose", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="vu-notes">Notes (optional)</Label>
            <Input id="vu-notes" maxLength={500} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : form.id === null ? "Add booking" : "Save changes"}
            </Button>
            {form.id === null && (
              <Button type="button" variant="outline" disabled={pending} onClick={addAll}>
                Add all Sundays in {formatMonthLabel(month)}
              </Button>
            )}
            {form.id !== null && (
              <Button
                type="button" variant="outline"
                onClick={() => { setForm(blankForm(nextSunday, today)); setFormState(undefined) }}
              >
                Cancel edit
              </Button>
            )}
            <FormFeedback state={formState} />
          </div>
        </form>
      </section>

      <BookingRequestPanel dataVersion={dataVersion} onSent={() => router.refresh()} />
      <InvoiceRequestPanel
        defaultMonth={defaultRequestMonth}
        dataVersion={dataVersion}
        onApproved={() => setApprovalCleared(false)}
      />
      <CalendarLinkBox url={calendarUrl} canReset={canResetCalendar} />
    </div>
  )
}
