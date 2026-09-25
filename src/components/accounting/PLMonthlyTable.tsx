import React from "react"
import { MONTH_LABELS } from "@/lib/reports/plHelpers"
import type { AccountGroup } from "@/lib/reports/accountGrouping"
import type { PLAccountRow } from "@/lib/reports/plQuery"
import { fmt, accountTotal } from "@/components/accounting/plFormat"

// Code + Category cols + 12 month cols + Total col
const MONTHLY_COLS = 2 + MONTH_LABELS.length + 1

/**
 * Renders account group rows + section total row for the monthly table.
 * acctMonthlyMap must contain an entry for every account in groups.
 */
function renderMonthlyGroups(
  groups: AccountGroup<PLAccountRow>[],
  sectionMonthly: number[],
  sectionTotal: number,
  totalLabel: string,
  acctMonthlyMap: Map<number, number[]>,
  totalMap: Map<number, number>,
  keyPrefix: string,
): React.ReactNode {
  return (
    <>
      {groups.map((group) => {
        const groupMonthly = group.accounts.reduce(
          (acc, a) => acc.map((v, i) => v + (acctMonthlyMap.get(a.id)?.[i] ?? 0)),
          new Array<number>(12).fill(0),
        )
        const groupTotal = group.accounts.reduce((s, a) => s + accountTotal(a, totalMap), 0)
        return (
          <React.Fragment key={`${keyPrefix}-${group.groupName}`}>
            <tr>
              <td colSpan={MONTHLY_COLS} className="pt-3 pb-0.5 pl-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {group.groupName}
              </td>
            </tr>
            {group.accounts.map((a) => {
              const acctMonthly = acctMonthlyMap.get(a.id) ?? new Array<number>(12).fill(0)
              return (
                <tr key={a.id} className="border-b border-border">
                  <td className="py-1.5 pr-3 pl-4 font-mono text-muted-foreground whitespace-nowrap">{a.code}</td>
                  <td className="py-1.5 pr-3 pl-4 whitespace-nowrap">
                    {a.name}
                    {!a.isActive && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
                  </td>
                  {acctMonthly.map((v, i) => (
                    <td key={i} className="py-1.5 px-1 text-right tabular whitespace-nowrap">
                      {fmt(v)}
                    </td>
                  ))}
                  <td className="py-1.5 pl-3 text-right tabular font-medium whitespace-nowrap">
                    {fmt(accountTotal(a, totalMap))}
                  </td>
                </tr>
              )
            })}
            <tr className="border-b border-border bg-muted">
              <td colSpan={2} className="py-1 pr-3 pl-4 text-xs text-muted-foreground italic whitespace-nowrap">
                {group.groupName} subtotal
              </td>
              {groupMonthly.map((v, i) => (
                <td key={i} className="py-1 px-1 text-right tabular text-xs font-medium whitespace-nowrap">
                  {fmt(v)}
                </td>
              ))}
              <td className="py-1 pl-3 text-right tabular text-xs font-medium whitespace-nowrap">
                {fmt(groupTotal)}
              </td>
            </tr>
          </React.Fragment>
        )
      })}
      <tr className="border-t-2 border-border font-semibold">
        <td colSpan={2} className="py-2 pr-3 whitespace-nowrap">{totalLabel}</td>
        {sectionMonthly.map((v, i) => (
          <td key={i} className="py-2 px-1 text-right tabular whitespace-nowrap">
            {fmt(v)}
          </td>
        ))}
        <td className="py-2 pl-3 text-right tabular whitespace-nowrap">{fmt(sectionTotal)}</td>
      </tr>
    </>
  )
}

type Props = {
  incomeGroups: AccountGroup<PLAccountRow>[]
  expenseGroups: AccountGroup<PLAccountRow>[]
  totalMap: Map<number, number>
  totalIncome: number
  totalExpenses: number
  net: number
  acctMonthlyMap: Map<number, number[]>
  incomeMonthly: number[]
  expenseMonthly: number[]
  netMonthly: number[]
}

export function PLMonthlyTable({
  incomeGroups,
  expenseGroups,
  totalMap,
  totalIncome,
  totalExpenses,
  net,
  acctMonthlyMap,
  incomeMonthly,
  expenseMonthly,
  netMonthly,
}: Props) {
  // Dense 15-column multi-month grid. Rendered on desktop as-is; on mobile the
  // default view is the stacked per-month summary below, but this full grid
  // stays reachable on demand inside a collapsible so per-account/group detail
  // is never lost below the lg breakpoint.
  const detailTable = (
      <table className="w-full min-w-table-wide text-sm">
        <thead>
          <tr className="border-b-2 border-border">
            <th className="text-left py-1 pr-3 font-semibold text-muted-foreground whitespace-nowrap">Code</th>
            <th className="text-left py-1 pr-3 font-semibold text-muted-foreground whitespace-nowrap">Category</th>
            {MONTH_LABELS.map((m) => (
              <th key={m} className="text-right py-1 px-1 font-semibold text-muted-foreground whitespace-nowrap">
                {m}
              </th>
            ))}
            <th className="text-right py-1 pl-3 font-semibold text-muted-foreground whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          {/* ── Income ── */}
          <tr>
            <td colSpan={MONTHLY_COLS} className="pt-4 pb-1 font-bold uppercase text-xs text-muted-foreground tracking-wide">
              Income
            </td>
          </tr>
          {renderMonthlyGroups(incomeGroups, incomeMonthly, totalIncome, "Total Income", acctMonthlyMap, totalMap, "ig")}

          {/* ── Expenses ── */}
          <tr>
            <td colSpan={MONTHLY_COLS} className="pt-4 pb-1 font-bold uppercase text-xs text-muted-foreground tracking-wide">
              Expenses
            </td>
          </tr>
          {renderMonthlyGroups(expenseGroups, expenseMonthly, totalExpenses, "Total Expenses", acctMonthlyMap, totalMap, "eg")}
        </tbody>
        <tfoot>
          <tr className="border-t-4 border-foreground font-bold text-base">
            <td colSpan={2} className="pt-3 pr-3 whitespace-nowrap">Net Surplus / (Deficit)</td>
            {netMonthly.map((v, i) => (
              <td
                key={i}
                className={`pt-3 px-1 text-right tabular whitespace-nowrap ${v >= 0 ? "text-income" : "text-expense"}`}
              >
                {fmt(v)}
              </td>
            ))}
            <td className={`pt-3 pl-3 text-right tabular whitespace-nowrap ${net >= 0 ? "text-income" : "text-expense"}`}>
              {fmt(net)}
            </td>
          </tr>
        </tfoot>
      </table>
  )
  return [
    <div key="desktop" className="overflow-x-auto hidden lg:block">
      {detailTable}
    </div>,
    <div key="mobile" className="lg:hidden">
      <div className="space-y-5 p-4">
        {MONTH_LABELS.map((m, i) => (
          <div key={m} className="rounded-lg border border-border">
            <div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide">
              {m}
            </div>
            <div className="grid grid-cols-2 gap-y-1 px-3 py-2 text-sm">
              <div>
                <span className="text-muted-foreground">Income</span>
                <div className="text-right tabular">{fmt(incomeMonthly[i])}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Expenses</span>
                <div className="text-right tabular">{fmt(expenseMonthly[i])}</div>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Net</span>
                <div
                  className={`text-right tabular font-medium ${netMonthly[i] >= 0 ? "text-income" : "text-expense"}`}
                >
                  {fmt(netMonthly[i])}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-border">
          <div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide">
            Totals
          </div>
          <div className="grid grid-cols-2 gap-y-1 px-3 py-2 text-sm">
            <div>
              <span className="text-muted-foreground">Income</span>
              <div className="text-right tabular font-medium">{fmt(totalIncome)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Expenses</span>
              <div className="text-right tabular font-medium">{fmt(totalExpenses)}</div>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Net</span>
              <div
                className={`text-right tabular font-medium ${net >= 0 ? "text-income" : "text-expense"}`}
              >
                {fmt(net)}
              </div>
            </div>
          </div>
        </div>
      </div>
      <details className="px-4 pb-4">
        <summary className="flex min-h-11 items-center cursor-pointer text-sm font-medium text-muted-foreground">
          Show full monthly detail
        </summary>
        <div className="overflow-x-auto pt-2">{detailTable}</div>
      </details>
    </div>
  ]
}
