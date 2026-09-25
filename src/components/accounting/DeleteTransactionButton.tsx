"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteTransaction } from "@/lib/actions/transaction"

export function DeleteTransactionButton({ id, locked = false }: { id: number; locked?: boolean }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteTransaction(id)}
      title="Delete this transaction?"
      description="This cannot be undone."
      triggerVariant="destructive"
      triggerSize="sm"
      triggerLabel="Delete"
      triggerClassName=""
      disabled={locked}
      disabledReason="Period locked"
    />
  )
}
