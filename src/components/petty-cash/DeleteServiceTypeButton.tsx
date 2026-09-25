"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteServiceType } from "@/lib/actions/serviceType"

export function DeleteServiceTypeButton({ id }: { id: number }) {
  return (
    <DeleteConfirmButton
      onConfirm={() => deleteServiceType(id)}
      title="Delete this service type?"
      description="This permanently removes the service type. This cannot be undone."
    />
  )
}
