"use client"

import { useRouter } from "next/navigation"
import { useActionState, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ActionResult } from "@/lib/actions/types"
import { fmtAUD } from "@/lib/formatting"

export function CloseSessionForm({
  action,
  balance,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  balance: number
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)
  const [counted, setCounted] = useState("")

  const countedNum = counted.trim() === "" ? null : Number(counted)
  const varianceCents =
    countedNum === null || Number.isNaN(countedNum)
      ? null
      : Math.round(countedNum * 100) - Math.round(balance * 100)
  const hasVariance = varianceCents !== null && varianceCents !== 0

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

      <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
        <p className="text-sm font-medium">Closing balance: {fmtAUD(balance)}</p>
        <p className="text-xs text-muted-foreground mt-1">
          This session will be permanently closed. No further receipts, expenses, or
          transfers can be added after closing.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="countedCash">
          Counted cash{" "}
          <span className="text-muted-foreground text-xs">(optional)</span>
        </Label>
        <Input
          id="countedCash"
          name="countedCash"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          placeholder="Amount physically counted"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
        />
        {varianceCents !== null && (
          <p
            aria-live="polite"
            className={
              varianceCents === 0
                ? "text-xs text-muted-foreground"
                : "text-xs text-destructive font-medium"
            }
          >
            {varianceCents === 0
              ? "Balanced — counted cash matches the system balance."
              : `${fmtAUD(Math.abs(varianceCents) / 100)} ${varianceCents > 0 ? "over" : "short"} vs system balance.`}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">
          Handover note{" "}
          <span className="text-muted-foreground text-xs">
            {hasVariance ? "(required — explain the variance)" : "(optional)"}
          </span>
        </Label>
        <Textarea
          id="notes"
          name="notes"
          required={hasVariance}
          placeholder="e.g. Handed to Mary Smith, balance $450.00"
          rows={3}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" variant="destructive" disabled={isPending}>
          {isPending ? "Closing…" : "Close session"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
