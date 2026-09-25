"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteTransfer } from "@/lib/actions/pettyCashTransfer"

export function DeleteTransferButton({ id, locked = false }: { id: number; locked?: boolean }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteTransfer(id)}
      title="Delete this transfer?"
      description="This permanently removes the bank-deposit transfer and its mirrored ledger entry. This cannot be undone."
      triggerVariant="outline"
      disabled={locked}
      disabledReason="Period locked"
    />
  )
}
