"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteReceipt } from "@/lib/actions/pettyCashReceipt"

export function DeleteReceiptButton({ id, locked = false }: { id: number; locked?: boolean }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteReceipt(id)}
      title="Delete this receipt?"
      description="This permanently removes the receipt and its mirrored ledger entry. This cannot be undone."
      triggerVariant="outline"
      disabled={locked}
      disabledReason="Period locked"
    />
  )
}
