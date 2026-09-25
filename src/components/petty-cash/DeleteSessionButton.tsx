"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteSession } from "@/lib/actions/pettyCashSession"

export function DeleteSessionButton({ id }: { id: number }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteSession(id)}
      title="Delete this session?"
      description="This permanently removes the petty-cash session. Sessions with receipts, expenses, or transfers cannot be deleted."
      triggerVariant="outline"
    />
  )
}
