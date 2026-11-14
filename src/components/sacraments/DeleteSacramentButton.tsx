"use client"

import { useRouter } from "next/navigation"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteSacramentRecord } from "@/lib/actions/sacrament"

/** Confirm-and-delete for one register entry; returns to the register on success. */
export function DeleteSacramentButton({ id, registerNo }: Readonly<{ id: number; registerNo: string }>) {
  const router = useRouter()
  return (
    <DeleteConfirmButton
      title={`Delete ${registerNo}?`}
      description="The entry is removed from the register and its number is not reused. Use this to fix a wrong rite or person, then enter it again."
      onConfirm={async () => {
        const r = await deleteSacramentRecord(id)
        if (r && "success" in r) router.push("/sacraments")
        return r && "error" in r ? r : undefined
      }}
    />
  )
}
