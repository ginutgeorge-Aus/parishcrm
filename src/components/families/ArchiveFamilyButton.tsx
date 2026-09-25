"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { archiveFamily } from "@/lib/actions/family"

export function ArchiveFamilyButton({ familyId, memberCount }: { familyId: number; memberCount: number }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => archiveFamily(familyId)}
      title="Archive this family?"
      description={`This will archive the family and all ${memberCount} member${memberCount !== 1 ? "s" : ""}. They will be excluded from all lists and reports. Archived families can be permanently deleted after 7 years (ATO record-keeping requirement).`}
      triggerVariant="outline"
      triggerSize="sm"
      triggerLabel="Archive"
      triggerClassName="h-11 sm:h-7 any-pointer-coarse:h-11"
      confirmLabel="Archive"
      pendingLabel="Archiving…"
    />
  )
}
