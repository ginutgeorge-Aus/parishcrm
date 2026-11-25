"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { assignToRosterSlot, suggestRosterAssignees, unassignRosterAssignment } from "@/lib/actions/roster"
import type { RosterSuggestion } from "@/lib/roster"
import type { RosterAssignmentStatus } from "@/lib/generated/prisma/enums"

/** One person rostered in a slot. */
export type SlotAssignment = { id: number; name: string; status: RosterAssignmentStatus }

const STATUS_LABEL: Record<RosterAssignmentStatus, string> = { PENDING: "Pending", CONFIRMED: "Confirmed", DECLINED: "Declined" }

/**
 * One slot of the service grid: who is rostered (with status and remove), how
 * many places are open, and an assign dropdown. The dropdown loads the
 * server's suggestions (no conflicts, longest since served first) on mount, so
 * it is already populated on first open and conflicting people are never offered.
 */
export function SlotCell({
  slotId, assignments, open,
}: Readonly<{ slotId: number; assignments: SlotAssignment[]; open: number }>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<RosterSuggestion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const latest = useRef(0)
  // True while a refetch is in flight: the retained options may be stale, so they are not selectable.
  const [refreshing, setRefreshing] = useState(false)
  // Still loading until the first response (or a load failure) arrives.
  const loading = options === null && loadError === null
  const assignedCount = assignments.length

  /** Fetch suggestions; only the most recent call may update state. Keeps current options while refetching. */
  const fetchOptions = useCallback(() => {
    const id = ++latest.current
    suggestRosterAssignees(slotId)
      .then((r) => {
        if (id !== latest.current) return
        if ("error" in r) setLoadError(r.error)
        else {
          setLoadError(null)
          setOptions(r.suggestions)
        }
      })
      .catch(() => {
        if (id === latest.current) setLoadError("Could not load people. Please try again.")
      })
      .finally(() => {
        if (id === latest.current) setRefreshing(false)
      })
  }, [slotId])

  // Load on mount (and again whenever this slot's fill changes after a refresh) so
  // the dropdown is populated on first open. Skipped when the slot is full.
  useEffect(() => {
    if (open > 0) fetchOptions()
  },[open, assignedCount, fetchOptions])

  /** Run a mutation, surface its error and refresh on success (the effect above reloads options). */
  function run(fn: () => Promise<{ error: string } | { success: string } | undefined>) {
    setError(null)
    startTransition(async () => {
      try {
        const r = await fn()
        if (r && "error" in r) setError(r.error)
        else router.refresh()
      } catch {
        setError("Something went wrong. Please try again.")
      }
    })
  }

  return (
    <div className="space-y-2">
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody rostered.</p>
      ) : (
        <ul className="space-y-1">
          {assignments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{a.name}</span>
                <Badge variant={a.status === "CONFIRMED" ? "secondary" : "outline"}>{STATUS_LABEL[a.status]}</Badge>
              </span>
              <Button
                type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" disabled={pending}
                aria-label={`Remove ${a.name}`} onClick={() => run(() => unassignRosterAssignment(a.id))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open > 0 && (
        <div className="flex items-center gap-2">
          <select
            aria-label="Assign a person"
            className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm sm:min-h-8"
            value=""
            disabled={pending}
            // Background refresh on open: another slot of this service may have taken someone since mount.
            onFocus={() => { setRefreshing(true); fetchOptions() }}
            onChange={(e) => {
              const personId = Number(e.target.value)
              if (personId) run(() => assignToRosterSlot(slotId, personId))
            }}
          >
            <option value="">{loading ? "Loading…" : `Assign (${open} open)…`}</option>
            {options?.length === 0 && <option disabled value="-1">No one available</option>}
            {options?.map((o) => (
              <option key={o.personId} value={o.personId} disabled={refreshing}>
                {o.firstName} {o.lastName}{o.lastServedYMD ? ` (last ${o.lastServedYMD})` : " (never served)"}
              </option>
            ))}
          </select>
        </div>
      )}
      <FormFeedback state={{ error: error ?? loadError }} />
    </div>
  )
}
