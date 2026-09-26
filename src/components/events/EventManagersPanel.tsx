"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { addEventManager, removeEventManager } from "@/lib/actions/eventAccess"

type Person = { id: number; name: string; email: string }

export function EventManagersPanel({
  eventId,
  managers,
  assignable,
}: {
  eventId: number
  managers: Person[]
  assignable: Person[]
}) {
  const [selected, setSelected] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Organisers not already assigned.
  const options = assignable.filter((a) => !managers.some((m) => m.id === a.id))

  function add() {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await addEventManager(eventId, Number.parseInt(selected, 10))
        if (res && "error" in res) setError(res.error)
        else setSelected("")
      } catch {
        setError("Could not assign manager. Please try again.")
      }
    })
  }

  function remove(userId: number) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await removeEventManager(eventId, userId)
        if (res && "error" in res) setError(res.error)
      } catch {
        setError("Could not remove manager. Please try again.")
      }
    })
  }

  return (
    <div className="mb-6 rounded-lg border bg-card p-4">
      <h2 className="mb-1 text-sm font-semibold text-foreground">Event managers</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Assigned organisers can view and export this event&apos;s registrations at{" "}
        <code>/my-events</code> — nothing else. Create their account first in Users (role: Event Organiser).
      </p>

      {managers.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {managers.map((m) => (
            <li key={m.id} className="flex items-center justify-between text-sm">
              <span>
                {m.name} <span className="text-muted-foreground">({m.email})</span>
              </span>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => remove(m.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">No managers assigned.</p>
      )}

      {options.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-full min-w-0 sm:w-64">
              <SelectValue placeholder="Add an organiser…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={String(o.id)}>
                  {o.name} ({o.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={pending || !selected} onClick={add}>
            Add
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No unassigned Event Organiser accounts. Create one in Users.
        </p>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
