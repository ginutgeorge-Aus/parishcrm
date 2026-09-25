"use client"

import { useRouter } from "next/navigation"
import { useActionState, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ActionResult } from "@/lib/actions/types"
import { APP_CURRENCY } from "@/lib/appConfig"

type Account = { id: number; code: string; name: string }
type Fund = { id: number; name: string }
type ExpenseDefaults = {
  amount: string
  payee: string
  accountId: string
  description: string
  receiptRef: string
  fundId: string
}

export function ExpenseForm({
  action,
  accounts,
  funds,
  expense,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  accounts: Account[]
  funds: Fund[]
  expense?: ExpenseDefaults
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)
  const generalFundId = funds.find((f) => f.name === "General")?.id
  // When editing, honour the stored fund even when it is "" (unassigned) — a
  // falsy check would silently re-default an unassigned expense to General.
  // Only a NEW expense (no `expense`) defaults to General.
  const [fundId, setFundId] = useState(
    expense
      ? expense.fundId
      : generalFundId != null ? String(generalFundId) : ""
  )

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state?.error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <p className="text-sm text-destructive">{state.error}</p>
          {/* Likely-duplicate warning: the button's own name/value pair
              is only included in the submitted FormData when it — not the main
              submit button — triggers the form, so re-submitting via the
              regular button never silently confirms a duplicate. */}
          {state.duplicateWarning && (
            <Button type="submit" name="confirmDuplicate" value="true" variant="outline" size="sm" disabled={isPending}>
              Post anyway
            </Button>
          )}
          {/* Negative-float warning: reaching it means the duplicate
              check already passed, so re-confirm confirmDuplicate=true alongside
              — otherwise a row that is both a duplicate and overdrawn would
              ping-pong between the two warnings. The hidden input is scoped to
              this block so it never auto-confirms a duplicate in the normal flow. */}
          {state.negativeBalanceWarning && (
            <>
              <input type="hidden" name="confirmDuplicate" value="true" />
              <Button type="submit" name="confirmNegative" value="true" variant="outline" size="sm" disabled={isPending}>
                Record anyway
              </Button>
            </>
          )}
        </div>
      )}

      {/* Date is not collected — server sets it to the session date */}
      <div className="space-y-1">
        <Label htmlFor="amount">Amount ({APP_CURRENCY})</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          defaultValue={expense?.amount}
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="payee">Payee</Label>
        <Input id="payee" name="payee" defaultValue={expense?.payee} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="accountId">Category</Label>
        <Select name="accountId" defaultValue={expense?.accountId ?? ""}>
          <SelectTrigger id="accountId">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.code} — {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="fundId">Fund</Label>
        {/* Radix Select can't have a SelectItem with an empty value, so
            "unassigned" is a non-empty sentinel mapped back to "" here — same
            pattern as TransactionForm's fund Select. */}
        <input type="hidden" name="fundId" value={fundId} />
        <Select value={fundId || "NONE"} onValueChange={(v: string) => setFundId(v === "NONE" ? "" : v)}>
          <SelectTrigger id="fundId" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">— unassigned —</SelectItem>
            {funds.map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" defaultValue={expense?.description} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="receiptRef">
          Receipt ref{" "}
          <span className="text-muted-foreground text-xs">(optional)</span>
        </Label>
        <Input id="receiptRef" name="receiptRef" defaultValue={expense?.receiptRef} />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : expense ? "Save changes" : "Add expense"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
