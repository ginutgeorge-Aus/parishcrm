"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { deleteDraftInvoice } from "@/lib/actions/invoice"

/** Delete button for an unnumbered draft invoice. */
export function DeleteDraftButton({ id }: Readonly<{ id: number }>) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      variant="destructive"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete this draft invoice?")) return
        start(async () => {
          const res = await deleteDraftInvoice(id)
          if ("error" in res) {
            window.alert(res.error)
            return
          }
          router.push("/accounting/invoices")
        })
      }}
    >
      Delete draft
    </Button>
  )
}
