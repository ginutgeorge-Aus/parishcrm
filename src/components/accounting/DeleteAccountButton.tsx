"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteAccount } from "@/lib/actions/account"

export function DeleteAccountButton({ accountId, accountName }: { accountId: number; accountName: string }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteAccount(accountId)}
      title={`Delete ${accountName}?`}
      description="This account will be permanently removed. Accounts with transactions cannot be deleted."
      triggerVariant="destructive"
      triggerSize="sm"
      triggerLabel="Delete"
      triggerClassName=""
    />
  )
}
