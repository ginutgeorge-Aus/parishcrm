"use client"

import { useRouter } from "next/navigation"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { archiveClass } from "@/lib/actions/sundaySchool"

/** Archive a class (never delete), then return to the class list. */
export function ArchiveClassButton({ classId, year }: Readonly<{ classId: number; year: number }>) {
  const router = useRouter()
  return (
    <DeleteConfirmButton
      onConfirm={async () => {
        const r = await archiveClass(classId)
        if (!r?.error) router.push(`/sunday-school?year=${year}`)
        return r
      }}
      title="Archive this class?"
      description="It disappears from the list; its enrolments and history are kept."
      triggerLabel="Archive class"
      triggerVariant="outline"
      triggerClassName="text-destructive hover:text-destructive min-h-11 sm:min-h-0"
      confirmLabel="Archive"
      pendingLabel="Archiving…"
    />
  )
}
