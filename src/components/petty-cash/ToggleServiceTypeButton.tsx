"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toggleServiceTypeActive } from "@/lib/actions/serviceType"

export function ToggleServiceTypeButton({
  id,
  isActive,
}: {
  id: number
  isActive: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await toggleServiceTypeActive(id)
            if (result?.error) setError(result.error)
          })
        }}
      >
        {isActive ? "Deactivate" : "Activate"}
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
