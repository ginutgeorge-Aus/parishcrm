"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteUser } from "@/lib/actions/user"

export function DeleteUserButton({
  userId,
  userName,
  triggerClassName = "",
}: {
  userId: number
  userName: string
  triggerClassName?: string
}) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteUser(userId)}
      title={`Delete ${userName}?`}
      description="This will permanently remove this user account. They will no longer be able to sign in."
      triggerVariant="destructive"
      triggerSize="sm"
      triggerLabel="Delete"
      triggerClassName={triggerClassName}
    />
  )
}
