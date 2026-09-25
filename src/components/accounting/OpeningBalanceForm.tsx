"use client"

import { useActionState } from "react"
import { upsertOpeningBalance } from "@/lib/actions/accountingSettings"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Balance = {
  amount: string
  asOfDate: Date
} | null

type BalanceRowProps = {
  paymentAccountId: number
  label: string
  current: Balance
}

function BalanceRow({ paymentAccountId, label, current }: BalanceRowProps) {
  const [state, formAction, isPending] = useActionState(upsertOpeningBalance, undefined)

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3 py-3 border-b border-border last:border-0">
      <input type="hidden" name="paymentAccountId" value={paymentAccountId} />
      <span className="w-24 text-sm font-medium text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">$</span>
        <Input
          type="number"
          name="amount"
          aria-label={`${label} opening amount`}
          step="0.01"
          min="0"
          defaultValue={current ? parseFloat(current.amount).toFixed(2) : ""}
          placeholder="0.00"
          required
          className="w-32 text-right"
        />
      </div>
      <Input
        type="date"
        name="asOfDate"
        aria-label={`${label} as-of date`}
        defaultValue={current ? current.asOfDate.toISOString().split("T")[0] : ""}
        required
        className="w-auto"
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
      <FormFeedback state={state} />
    </form>
  )
}

type Props = {
  accounts: { id: number; name: string }[]
  balancesByAccountId: Map<number, Balance>
}

export function OpeningBalanceForm({ accounts, balancesByAccountId }: Props) {
  return (
    <div>
      {accounts.map((a) => (
        <BalanceRow
          key={a.id}
          paymentAccountId={a.id}
          label={a.name}
          current={balancesByAccountId.get(a.id) ?? null}
        />
      ))}
    </div>
  )
}
