"use client"

import { upsertOpeningBalance } from "@/lib/actions/accountingSettings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { FormError } from "@/components/shared/FormError"
import { useRetainedForm } from "@/components/shared/useRetainedForm"

type Balance = {
  amount: string
  asOfDate: Date
} | null

type BalanceRowProps = {
  paymentAccountId: number
  label: string
  current: Balance
}

function BalanceRow({ paymentAccountId, label, current }: Readonly<BalanceRowProps>) {
  const [state, onSubmit, isPending, errorSeq] = useRetainedForm(upsertOpeningBalance)

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3 py-3 border-b border-border last:border-0">
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
          defaultValue={current ? Number.parseFloat(current.amount).toFixed(2) : ""}
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
      <FormError error={state && "error" in state ? state.error : undefined} errorKey={errorSeq} />
      <FormFeedback state={state && "success" in state ? state : undefined} />
    </form>
  )
}

type Props = {
  accounts: { id: number; name: string }[]
  balancesByAccountId: Map<number, Balance>
}

export function OpeningBalanceForm({ accounts, balancesByAccountId }: Readonly<Props>) {
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
