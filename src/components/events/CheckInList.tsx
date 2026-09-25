"use client"

import { useMemo, useState, useTransition } from "react"
import { toggleAttendeeCheckIn } from "@/lib/actions/registration"
import { QrScanButton } from "@/components/events/QrScanButton"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Attendee = {
  attendeeId: number
  name: string
  ticketName: string
  registrantName: string
  ref: string
  checkedIn: boolean
}

export function CheckInList({ eventId, attendees }: { eventId: number; attendees: Attendee[] }) {
  // One map of all check-in states so the header count derives from local state
  // and each row toggles optimistically (mirrors ReconcileToggleButton).
  const [state, setState] = useState<Record<number, boolean>>(
    () => Object.fromEntries(attendees.map(a => [a.attendeeId, a.checkedIn])),
  )
  const [query, setQuery] = useState("")
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Per-attendee in-flight guard: a single shared isPending would
  // disable every row while any one toggle is in flight. This tracks just
  // the rows with a request outstanding, disabling only those buttons and
  // blocking a double-click on the same row from firing two overlapping
  // toggle requests.
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set())

  // A revalidated attendee list (new rows, check-ins from another device) must
  // replace the lazy-initialised map — keep only in-flight optimistic flips
  //. Adjust-state-during-render, not an effect, so no stale frame.
  const [prevAttendees, setPrevAttendees] = useState(attendees)
  if (attendees !== prevAttendees) {
    setPrevAttendees(attendees)
    setState(prev =>
      Object.fromEntries(
        attendees.map(a => [a.attendeeId, pendingIds.has(a.attendeeId) ? (prev[a.attendeeId] ?? a.checkedIn) : a.checkedIn]),
      ),
    )
  }

  const checkedInCount = useMemo(() => attendees.filter(a => state[a.attendeeId]).length, [attendees, state])

  const q = query.trim().toLowerCase()
  const visible = q
    ? attendees.filter(a => a.name.toLowerCase().includes(q) || a.ref.toLowerCase().includes(q))
    : attendees

  function toggle(a: Attendee) {
    if (pendingIds.has(a.attendeeId)) return // request already in flight — ignore a double-click
    const next = !state[a.attendeeId]
    setState(prev => ({ ...prev, [a.attendeeId]: next }))
    setError(null)
    setPendingIds(prev => new Set(prev).add(a.attendeeId))
    startTransition(async () => {
      try {
        const result = await toggleAttendeeCheckIn(a.attendeeId, eventId, next)
        if (result && "error" in result) {
          setState(prev => ({ ...prev, [a.attendeeId]: !next }))
          setError(result.error)
        }
      } catch {
        // toggleAttendeeCheckIn threw/rejected (not a structured {error} result) —
        // revert the optimistic flip so state doesn't silently drift from the
        // server.
        setState(prev => ({ ...prev, [a.attendeeId]: !next }))
        setError("Failed to update check-in status. Please try again.")
      } finally {
        setPendingIds(prev => {
          const next = new Set(prev)
          next.delete(a.attendeeId)
          return next
        })
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search name or ref…"
          aria-label="Search by name or check-in code"
          className="flex-1"
        />
        <QrScanButton onScan={token => { setError(null); setQuery(token) }} />
        <span className="text-sm font-semibold text-foreground whitespace-nowrap">
          {checkedInCount} / {attendees.length} checked in
        </span>
      </div>
      <FormFeedback state={{ error }} />
      <ul className="flex flex-col gap-2">
        {visible.map(a => {
          const on = state[a.attendeeId]
          return (
            <li key={a.attendeeId} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{a.name}</p>
                <p className="text-xs text-muted-foreground">{a.ticketName} · {a.registrantName} · {a.ref}</p>
              </div>
              <Button
                onClick={() => toggle(a)}
                disabled={pendingIds.has(a.attendeeId)}
                aria-label={on ? `Check out ${a.name}` : `Check in ${a.name}`}
                className={`min-h-11 min-w-24 ${on ? "bg-income/10 text-income hover:bg-income/20" : ""}`}
              >
                {on ? "✓ Present" : "Check in"}
              </Button>
            </li>
          )
        })}
        {visible.length === 0 && <li className="text-sm text-muted-foreground py-6 text-center">No attendees match.</li>}
      </ul>
    </div>
  )
}
