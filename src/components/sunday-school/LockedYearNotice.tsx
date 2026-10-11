"use client"

import { useRouter } from "next/navigation"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { Badge } from "@/components/ui/badge"
import { lockSundaySchoolYear, unlockSundaySchoolYear } from "@/lib/actions/sundaySchool"

/**
 * ADMIN "Lock year" button for an open year, behind a confirm dialog that
 * warns edits stop. The page decides who sees it; the action re-checks.
 */
export function LockYearButton({ year }: Readonly<{ year: number }>) {
  const router = useRouter()
  return (
    <DeleteConfirmButton
      onConfirm={async () => {
        const r = await lockSundaySchoolYear(year)
        if (r && "success" in r) {
          router.refresh()
          return
        }
        return r
      }}
      title={`Lock ${year}?`}
      description={`Lock ${year}? Classes, enrolments and the roll for ${year} can't be edited until an admin unlocks it.`}
      triggerLabel="Lock year"
      triggerVariant="outline"
      triggerClassName="min-h-11 sm:min-h-0"
      confirmLabel="Lock"
      pendingLabel="Locking…"
    />
  )
}

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
