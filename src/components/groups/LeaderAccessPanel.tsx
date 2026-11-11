"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { addGroupLeaderAccess, removeGroupLeaderAccess } from "@/lib/actions/group"

type Login = { id: number; name: string; email: string }
/** A linked login; `active` false = no longer an Event organiser, so it grants nothing. */
type Linked = Login & { active: boolean }

/**
 * Link volunteer logins (EVENT_ORGANISER) that may manage this group's members
 * from My groups. Separate from the LEADER member role, since a leader may have
 * no login. Manager-only; `readOnly` (archived group) lists links with remove only.
 */
export function LeaderAccessPanel({
  groupId, linked, assignable, readOnly = false,
}: Readonly<{ groupId: number; linked: Linked[]; assignable: Login[]; readOnly?: boolean }>) {
  const [selected, setSelected] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const options = assignable.filter((a) => !linked.some((m) => m.id === a.id))

  /** Run a link/unlink action, surfacing any error. */
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
        Volunteer logins (role <em>Event organiser</em>) that can add and remove this group&apos;s members from their phone.
        Create the login under Users.
      </p>
      {linked.length > 0 ? (
        <ul className="space-y-1">
          {linked.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {m.name} <span className="text-muted-foreground">({m.email})</span>
                {!m.active && <span className="ml-2 text-xs text-destructive">inactive: no longer an Event organiser</span>}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 sm:min-h-0"
                disabled={pending}
                onClick={() => run(() => removeGroupLeaderAccess(groupId, m.id), "Could not remove. Please try again.")}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No leader logins linked.</p>
      )}
      {readOnly ? null : options.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-full min-w-0 sm:w-64" aria-label="Link a leader login">
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
            className="min-h-11 sm:min-h-0"
            disabled={pending || !selected}
            onClick={() => run(() => addGroupLeaderAccess(groupId, Number.parseInt(selected, 10)), "Could not link. Please try again.", () => setSelected(""))}
          >
            Add
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No unlinked Event organiser logins. Create one in Users.</p>
      )}
      <FormFeedback state={{ error }} />
    </div>
  )
}
