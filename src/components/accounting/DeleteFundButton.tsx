"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteFund } from "@/lib/actions/fund"

export function DeleteFundButton({ fundId, fundName }: { fundId: number; fundName: string }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteFund(fundId)}
      title={`Delete ${fundName}?`}
      description="Funds with entries cannot be deleted. The General fund cannot be deleted."
      triggerVariant="destructive"
      triggerSize="sm"
      triggerLabel="Delete"
      triggerClassName=""
    />
  )
}
