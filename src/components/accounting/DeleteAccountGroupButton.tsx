"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteAccountGroup } from "@/lib/actions/accountGroup"

export function DeleteAccountGroupButton({ groupId, groupName }: { groupId: number; groupName: string }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteAccountGroup(groupId)}
      title={`Delete ${groupName}?`}
      description="This group will be permanently removed. Groups with accounts cannot be deleted."
      triggerVariant="destructive"
      triggerSize="sm"
      triggerLabel="Delete"
      triggerClassName=""
    />
  )
}
