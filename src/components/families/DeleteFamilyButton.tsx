"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteFamily } from "@/lib/actions/family"

export function DeleteFamilyButton({
  familyId,
  familyName,
  triggerClassName = "",
}: {
  familyId: number
  familyName: string
  triggerClassName?: string
}) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteFamily(familyId)}
      title={`Permanently delete ${familyName}?`}
      description="This removes the family and its members for good. Families with giving history cannot be deleted — keep them archived instead."
      triggerVariant="destructive"
      triggerSize="sm"
      triggerLabel="Permanently delete"
      triggerClassName={triggerClassName}
    />
  )
}
