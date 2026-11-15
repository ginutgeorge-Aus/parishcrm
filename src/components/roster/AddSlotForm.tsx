"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { addRosterSlot } from "@/lib/actions/roster"

/** A role that can still be added to this service. */
export type AddableRole = { id: number; name: string; defaultCount: number }

/** Add a role (slot) to a service; the head-count starts at the role's default. Staff only (the action enforces it). */
export function AddSlotForm({ serviceId, roles }: Readonly<{ serviceId: number; roles: AddableRole[] }>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [roleId, setRoleId] = useState("")
  const [error, setError] = useState<string | null>(null)
  if (roles.length === 0) return null

  /** Add the chosen role's slot and refresh. */
  function add() {
    const role = roles.find((r) => String(r.id) === roleId)
    if (!role) return
    setError(null)
    startTransition(async () => {
      try {
        const r = await addRosterSlot(serviceId, role.id, role.defaultCount)
        if (r && "error" in r) setError(r.error)
        else {
          setRoleId("")
          router.refresh()
        }
      } catch {
        setError("Could not add the role. Please try again.")
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          aria-label="Role to add"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm sm:min-h-8 sm:max-w-xs"
        >
          <option value="">Add a role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <Button type="button" className="min-h-11 sm:min-h-0" disabled={pending || !roleId} onClick={add}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      <FormFeedback state={{ error }} />
    </div>
  )
}
