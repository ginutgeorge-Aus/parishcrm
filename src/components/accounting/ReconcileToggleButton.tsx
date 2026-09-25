"use client"

import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { toggleReconciled } from "@/lib/actions/transactionReconcile"

export function ReconcileToggleButton({
  id,
  reconciled,
  paymentAccountId,
}: {
  id: number
  reconciled: boolean
  paymentAccountId: number
}) {
  const [optimistic, setOptimistic] = useState(reconciled)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    const next = !optimistic
    setOptimistic(next)
    setError(null)
    startTransition(async () => {
      try {
        const result = await toggleReconciled(id, paymentAccountId)
        if (result?.error) {
          setOptimistic(!next)
          setError(result.error)
        }
      } catch {
        // Transport-level throw never reaches the {error} branch — revert the
        // optimistic flip so the badge can't show a false state.
        setOptimistic(!next)
        setError("Something went wrong, try again")
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={optimistic ? "Mark as pending" : "Mark as reconciled"}
      >
        {optimistic
          ? <Badge variant="default">Reconciled</Badge>
          : <Badge variant="outline">Pending</Badge>}
      </button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
