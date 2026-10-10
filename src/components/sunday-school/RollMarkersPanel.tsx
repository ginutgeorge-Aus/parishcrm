"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { addRollMarker, removeRollMarker } from "@/lib/actions/sundaySchoolAttendance"

type Login = { id: number; name: string; email: string }

/**
 * Assign volunteer logins (EVENT_ORGANISER) that may take this class's roll
 * from /my-classes. Editor-only; rendered inside the class page's card.
 */
export function RollMarkersPanel({
  classId, markers, assignable,
}: Readonly<{ classId: number; markers: Login[]; assignable: Login[] }>) {
  const [selected, setSelected] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const options = assignable.filter((a) => !markers.some((m) => m.id === a.id))

  /** Run an assign/unassign action, surfacing any error. */
  function run(fn: () => Promise<{ error: string } | undefined>, failMsg: string, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (res && "error" in res) setError(res.error)
        else onOk?.()
      } catch {
        setError(failMsg)
      }
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Volunteer logins (role <em>Event organiser</em>) that can take this class&apos;s roll from their phone.
        Create the login under Users.
      </p>
      {markers.length > 0 ? (
        <ul className="space-y-1">
          {markers.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {m.name} <span className="text-muted-foreground">({m.email})</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => removeRollMarker(classId, m.id), "Could not remove. Please try again.")}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No roll markers assigned.</p>
      )}
      {options.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-full min-w-0 sm:w-64" aria-label="Add a roll marker">
              <SelectValue placeholder="Add a volunteer login…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={String(o.id)}>
                  {o.name} ({o.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={pending || !selected}
            onClick={() => run(() => addRollMarker(classId, Number.parseInt(selected, 10)), "Could not assign. Please try again.", () => setSelected(""))}
          >
            Add
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No unassigned Event organiser logins. Create one in Users.</p>
      )}
      <FormFeedback state={{ error }} />
    </div>
  )
}
