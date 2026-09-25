"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteExpense } from "@/lib/actions/pettyCashExpense"

export function DeleteExpenseButton({ id, locked = false }: { id: number; locked?: boolean }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteExpense(id)}
      title="Delete this expense?"
      description="This permanently removes the expense and its mirrored ledger entry. This cannot be undone."
      disabled={locked}
      disabledReason="Period locked"
    />
  )
}
