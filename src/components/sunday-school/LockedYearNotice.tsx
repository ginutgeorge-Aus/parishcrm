"use client"

import { useRouter } from "next/navigation"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { Badge } from "@/components/ui/badge"
import { unlockSundaySchoolYear } from "@/lib/actions/sundaySchool"

/**
 * "Locked (rolled over)" badge for a closed school year. When `canUnlock`
 * (ADMIN, decided by the page; the action re-checks) it also shows an
 * "Unlock year" button behind a confirm dialog, then refreshes the list.
 */
export function LockedYearNotice({ year, canUnlock }: Readonly<{ year: number; canUnlock: boolean }>) {
  const router = useRouter()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">Locked (rolled over)</Badge>
      {canUnlock && (
        <DeleteConfirmButton
          onConfirm={async () => {
            const r = await unlockSundaySchoolYear(year)
            if (r && "success" in r) {
              router.refresh()
              return
            }
            return r
          }}
          title={`Unlock ${year}?`}
          description={`Unlock ${year}? Classes, enrolments and the roll for ${year} become editable again.`}
          triggerLabel="Unlock year"
          triggerVariant="outline"
          triggerClassName="min-h-11 sm:min-h-0"
          confirmLabel="Unlock"
          pendingLabel="Unlocking…"
        />
      )}
    </div>
  )
}
