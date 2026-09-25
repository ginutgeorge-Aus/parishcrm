import type { AccountGroup } from "@/lib/reports/accountGrouping"
import type { PLAccountRow } from "@/lib/reports/plQuery"
import { fmt, accountTotal } from "@/components/accounting/plFormat"

type Props = {
  incomeGroups: AccountGroup<PLAccountRow>[]
  expenseGroups: AccountGroup<PLAccountRow>[]
  totalMap: Map<number, number>
  totalIncome: number
  totalExpenses: number
  net: number
}

export function PLMobileCards({
  incomeGroups,
  expenseGroups,
  totalMap,
  totalIncome,
  totalExpenses,
  net,
}: Props) {
  return (
    // Mobile: card per account group (avoids sideways table scroll)
    <div className="space-y-4 md:hidden">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Income</p>
        <ul className="space-y-2">
          {incomeGroups.map((group) => {
            const groupTotal = group.accounts.reduce((s, a) => s + accountTotal(a, totalMap), 0)
            return (
              <li key={`ig-card-${group.groupName}`} className="rounded-lg border bg-card p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.groupName}</p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {group.accounts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="mr-1 font-mono text-xs text-muted-foreground">{a.code}</span>
                        {a.name}
                        {!a.isActive && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
                      </span>
                      <span className="shrink-0 tabular">{fmt(accountTotal(a, totalMap))}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t pt-1.5 text-xs font-medium text-muted-foreground">
                  <span>{group.groupName} subtotal</span>
                  <span className="tabular">{fmt(groupTotal)}</span>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="mt-2 flex items-center justify-between rounded-lg bg-secondary p-3 text-sm font-semibold">
          <span>Total Income</span>
          <span className="tabular">{fmt(totalIncome)}</span>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Expenses</p>
        <ul className="space-y-2">
          {expenseGroups.map((group) => {
            const groupTotal = group.accounts.reduce((s, a) => s + accountTotal(a, totalMap), 0)
            return (
              <li key={`eg-card-${group.groupName}`} className="rounded-lg border bg-card p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.groupName}</p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {group.accounts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="mr-1 font-mono text-xs text-muted-foreground">{a.code}</span>
                        {a.name}
                        {!a.isActive && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
                      </span>
                      <span className="shrink-0 tabular">{fmt(accountTotal(a, totalMap))}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t pt-1.5 text-xs font-medium text-muted-foreground">
                  <span>{group.groupName} subtotal</span>
                  <span className="tabular">{fmt(groupTotal)}</span>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="mt-2 flex items-center justify-between rounded-lg bg-secondary p-3 text-sm font-semibold">
          <span>Total Expenses</span>
          <span className="tabular">{fmt(totalExpenses)}</span>
        </div>
      </div>

      <div className={`flex items-center justify-between rounded-lg border p-3 text-base font-bold ${net >= 0 ? "text-income" : "text-expense"}`}>
        <span>Net Surplus / (Deficit)</span>
        <span className="tabular">{fmt(net)}</span>
      </div>
    </div>
  )
}
