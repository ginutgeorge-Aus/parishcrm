"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deletePerson } from "@/lib/actions/person"

export function DeletePersonButton({
  personId,
  familyId,
  personName,
}: {
  personId: number
  familyId: number
  personName: string
}) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deletePerson(personId, familyId)}
      title={`Delete ${personName}?`}
      description="This will permanently remove this person. This cannot be undone."
      triggerVariant="destructive"
      triggerSize="sm"
      triggerLabel="Delete"
      triggerClassName="h-11 sm:h-7 any-pointer-coarse:h-11"
    />
  )
}
