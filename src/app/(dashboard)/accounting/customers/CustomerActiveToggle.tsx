"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { setCustomerActive } from "@/lib/actions/customer"

/** Activate / deactivate button for one customer row. */
export function CustomerActiveToggle({ id, isActive }: Readonly<{ id: number; isActive: boolean }>) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setCustomerActive(id, !isActive)
          if ("error" in res) window.alert(res.error)
          router.refresh()
        })
      }
    >
      {isActive ? "Deactivate" : "Reactivate"}
    </Button>
  )
}
