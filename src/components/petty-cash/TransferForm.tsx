"use client"

import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { sydneyTodayYMD } from "@/lib/dates"
import { fmtAUD } from "@/lib/formatting"
import type { ActionResult } from "@/lib/actions/types"
import { APP_CURRENCY } from "@/lib/appConfig"

export function TransferForm({
  action,
  maxAmount,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  maxAmount: number
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        Current cash in hand: <span className="font-semibold">{fmtAUD(maxAmount)}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="date">Transfer date</Label>
          <Input
            id="date"
            name="date"
            type="date"
            defaultValue={sydneyTodayYMD()}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="amount">Amount deposited ({APP_CURRENCY})</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            max={maxAmount.toFixed(2)}
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="retainedFloat">
          Retained float ({APP_CURRENCY}){" "}
          <span className="text-muted-foreground text-xs">(informational — amount kept back)</span>
        </Label>
        <Input
          id="retainedFloat"
          name="retainedFloat"
          type="number"
          step="0.01"
          min="0"
          defaultValue="0.00"
          placeholder="0.00"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="depositedByName">Deposited by</Label>
        <Input id="depositedByName" name="depositedByName" required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="depositSlipRef">
          Deposit slip ref{" "}
          <span className="text-muted-foreground text-xs">(optional)</span>
        </Label>
        <Input id="depositSlipRef" name="depositSlipRef" />
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">
          Notes <span className="text-muted-foreground text-xs">(optional)</span>
        </Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Record transfer"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
