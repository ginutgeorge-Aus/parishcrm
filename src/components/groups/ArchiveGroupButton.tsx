"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { archiveGroup, restoreGroup } from "@/lib/actions/group"

/** Archive a group (never delete), then return to the group list. */
export function ArchiveGroupButton({ groupId }: Readonly<{ groupId: number }>) {
  const router = useRouter()
  return (
    <DeleteConfirmButton
      onConfirm={async () => {
        const r = await archiveGroup(groupId)
        if (!r?.error) router.push("/groups")
        return r
      }}
      title="Archive this group?"
      description="It disappears from the list and from leaders' My groups; its members are kept and it can be restored."
      triggerLabel="Archive group"
      triggerVariant="outline"
      triggerClassName="text-destructive hover:text-destructive min-h-11 sm:min-h-0"
      confirmLabel="Archive"
      pendingLabel="Archiving…"
    />
  )
}

/** Restore an archived group to the live list. */
export function RestoreGroupButton({ groupId }: Readonly<{ groupId: number }>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  /** Run restoreGroup and refresh, surfacing any error. */
  function restore() {
    setError(null)
    startTransition(async () => {
      try {
        const r = await restoreGroup(groupId)
        if (r?.error) setError(r.error)
        else router.refresh()
      } catch {
        setError("Could not restore. Please try again.")
      }
    })
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" className="min-h-11 sm:min-h-0" disabled={pending} onClick={restore}>
        {pending ? "Restoring…" : "Restore group"}
      </Button>
      <FormFeedback state={{ error }} />
    </div>
  )
}
