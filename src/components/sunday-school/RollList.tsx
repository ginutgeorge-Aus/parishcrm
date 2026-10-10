"use client"

import { useLayoutEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { setAttendance, markUnmarkedPresent } from "@/lib/actions/sundaySchoolAttendance"
import type { AttendanceStatus } from "@/lib/generated/prisma/enums"
import { ATTENDANCE_LABELS, ATTENDANCE_STATUSES, rollCounts, type RollRow } from "@/lib/sundaySchoolRollView"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Status = AttendanceStatus | null

const ACTIVE: Record<AttendanceStatus, string> = {
  PRESENT: "bg-income/10 text-income hover:bg-income/20 border-income/40",
  LATE: "bg-warning/20 text-warning-foreground hover:bg-warning/30 border-warning/50",
  ABSENT: "bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/40",
}

/**
 * Mobile roll for one class + date. Each row marks Present / Late / Absent
 * optimistically (tap the active status again to clear) and reverts if the
 * server refuses. "Mark unmarked present" fills every unmarked child at once.
 * Read-only mode shows statuses as text (VIEWER, archived class).
 */
export function RollList({
  classId, date, today, rows, readOnly, dateHrefBase,
}: Readonly<{ classId: number; date: string; today: string; rows: RollRow[]; readOnly: boolean; dateHrefBase: string }>) {
  const router = useRouter()
  const [state, setState] = useState<Record<number, Status>>(() => Object.fromEntries(rows.map(r => [r.personId, r.status])))
  const [query, setQuery] = useState("")
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null)
  const [, startTransition] = useTransition()
  // Rows with a request in flight: only those are disabled, and a double tap
  // on the same row can't fire two overlapping writes.
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set())
  const [bulkPending, setBulkPending] = useState(false)

  // A refreshed roll (marks from another phone) replaces the local map, keeping
  // only in-flight optimistic marks — and only for the same date: a new date's
  // roll never inherits another date's marks. Adjust-state-during-render.
  const [prev, setPrev] = useState({ rows, date })
  if (rows !== prev.rows || date !== prev.date) {
    const sameDate = date === prev.date
    setPrev({ rows, date })
    setState(cur => Object.fromEntries(rows.map(r => [r.personId, sameDate && pendingIds.has(r.personId) ? (cur[r.personId] ?? r.status) : r.status])))
  }
  const busy = bulkPending || pendingIds.size > 0
  // The date on screen now; a late failure only reverts if it's still the
  // request's date (Back/Forward can change it despite the locked picker).
  // Layout effect: updated synchronously in the commit, so no promise callback
  // can run between a date change rendering and the ref seeing it.
  const shownDate = useRef(date)
  useLayoutEffect(() => { shownDate.current = date }, [date])

  const counts = rollCounts(rows.map(r => ({ status: state[r.personId] ?? null })))
  const q = query.trim().toLowerCase()
  const visible = q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows

  /** Drop one id from the in-flight set. */
  function settle(personId: number) {
    setPendingIds(prev => {
      const next = new Set(prev)
      next.delete(personId)
      return next
    })
  }

  /**
   * Undo a failed optimistic mark, then refetch the roll: rows refreshed while
   * the mark was in flight (another phone) make prevStatus stale, so the
   * server's current status must win.
   */
  function revert(personId: number, prevStatus: Status) {
    if (shownDate.current === date) setState(prev => ({ ...prev, [personId]: prevStatus }))
    router.refresh()
  }

  /**
   * Tap a status button: mark it, or clear when it's already the active one.
   * A child who has left the class can't be cleared (their mark is the only
   * link to this roll), so re-tapping their active status does nothing.
   */
  function mark(r: RollRow, tapped: AttendanceStatus) {
    if (pendingIds.has(r.personId) || bulkPending) return
    const prevStatus = state[r.personId] ?? null
    if (prevStatus === tapped && !r.enrolled) return
    const next: Status = prevStatus === tapped ? null : tapped
    setState(prev => ({ ...prev, [r.personId]: next }))
    setFeedback(null)
    setPendingIds(prev => new Set(prev).add(r.personId))
    startTransition(async () => {
      try {
        const result = await setAttendance(classId, date, r.personId, next)
        if (result && "error" in result) {
          revert(r.personId, prevStatus)
          setFeedback({ error: result.error })
        }
      } catch {
        revert(r.personId, prevStatus)
        setFeedback({ error: "Couldn't save that mark. Please try again." })
      } finally {
        settle(r.personId)
      }
    })
  }

  /** Mark every child still unmarked as Present, then resync with the server. */
  function markRestPresent() {
    if (busy) return
    setFeedback(null)
    setBulkPending(true)
    startTransition(async () => {
      try {
        const result = await markUnmarkedPresent(classId, date)
        if (result && "error" in result) {
          setFeedback({ error: result.error })
          return
        }
        // Only enrolled rows still unmarked locally (the server skips the rest);
        // never overwrite a mark made meanwhile. Skip if the shown date changed
        // (e.g. browser Back) so old rows never mark another date's roll.
        if (shownDate.current === date) setState(prev => {
          const next = { ...prev }
          for (const r of rows) if (r.enrolled && !next[r.personId]) next[r.personId] = "PRESENT"
          return next
        })
        if (result) setFeedback({ success: result.success })
        router.refresh()
      } catch {
        setFeedback({ error: "Couldn't mark the class present. Please try again." })
      } finally {
        setBulkPending(false)
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-muted pb-2 pt-1">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="date"
            aria-label="Roll date"
            value={date}
            max={today}
            // Locked while a mark is saving so a late failure can't revert a row on another date's roll.
            disabled={busy}
            // Desktop typing emits partial years (0002-10-04); the class year is
            // fixed, so only navigate once the year matches the roll's.
            onChange={e => { if (e.target.value.slice(0, 4) === date.slice(0, 4)) router.push(`${dateHrefBase}?date=${e.target.value}`) }}
            className="w-auto"
          />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name…"
            aria-label="Search by name"
            className="min-w-40 flex-1"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground" aria-live="polite">
            {counts.present} present · {counts.late} late · {counts.absent} absent · {counts.unmarked} not marked
          </p>
          {!readOnly && counts.unmarked > 0 && (
            <Button onClick={markRestPresent} disabled={busy} className="min-h-11">
              Mark unmarked present
            </Button>
          )}
        </div>
        <FormFeedback state={feedback} />
      </div>
      <ul className="flex flex-col gap-2">
        {visible.map(r => {
          const current = state[r.personId] ?? null
          return (
            <li key={r.personId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold text-foreground">
                {r.name}
                {!r.enrolled && <span className="ml-2 text-xs font-normal text-muted-foreground">not enrolled</span>}
              </p>
              {readOnly ? (
                <span className="text-sm text-muted-foreground">{current ? ATTENDANCE_LABELS[current] : "Not marked"}</span>
              ) : (
                <div role="group" aria-label={`Attendance for ${r.name}`} className="flex flex-wrap gap-2">
                  {ATTENDANCE_STATUSES.map(s => (
                    <Button
                      key={s}
                      variant="outline"
                      aria-pressed={current === s}
                      disabled={pendingIds.has(r.personId) || bulkPending}
                      onClick={() => mark(r, s)}
                      className={`min-h-11 min-w-20 ${current === s ? ACTIVE[s] : ""}`}
                    >
                      {ATTENDANCE_LABELS[s]}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          )
        })}
        {visible.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            {rows.length === 0 ? "No children enrolled in this class." : "No children match."}
          </li>
        )}
      </ul>
    </div>
  )
}
