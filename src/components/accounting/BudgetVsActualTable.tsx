import React from "react"
import { type AccountGroup } from "@/lib/reports/accountGrouping"
import { fmtAUDAccounting, toCents, centsToNumber, sumCents } from "@/lib/formatting"
import { isOverVarianceThreshold } from "@/lib/reports/budgetVarianceHelpers"
import { type BudgetActualRow } from "@/lib/reports/budgetVsActualQuery"
import { VarianceNote } from "@/components/accounting/VarianceNote"
import { fmtSigned, fmtPct, varianceColor, VarianceFlag } from "@/components/accounting/budgetVarianceFormat"

type Props = {
  incomeGroups: AccountGroup<BudgetActualRow>[]
  expenseGroups: AccountGroup<BudgetActualRow>[]
  totalIncomeBudget: number
  totalIncomeActual: number
  totalExpenseBudget: number
  totalExpenseActual: number
  netBudget: number
  netActual: number
  incomeVariance: number
  expenseVariance: number
  netVariance: number
  year: number
  varianceThresholdPct: number
  canEditNotes: boolean
}

export function BudgetVsActualTable({
  incomeGroups,
  expenseGroups,
  totalIncomeBudget,
  totalIncomeActual,
  totalExpenseBudget,
  totalExpenseActual,
  netBudget,
  netActual,
  incomeVariance,
  expenseVariance,
  netVariance,
  year,
  varianceThresholdPct,
  canEditNotes,
}: Props) {
  function renderAccountRow(r: BudgetActualRow, isIncome: boolean) {
    const variance = r.budget !== null ? centsToNumber(toCents(r.actual) - toCents(r.budget)) : null
    const color = variance !== null ? varianceColor(variance, isIncome) : "text-muted-foreground"
    const budgetNum = r.budget !== null ? centsToNumber(toCents(r.budget)) : 0
    const flagged = variance !== null && isOverVarianceThreshold(variance, budgetNum, varianceThresholdPct)
    // Notes attach to lines that have a budget. Editors get the add/edit
    // affordance on flagged lines; anyone sees an existing note.
    const showNote = r.budget !== null && (canEditNotes ? flagged || Boolean(r.note) : Boolean(r.note))
    return (
      <React.Fragment key={r.id}>
        <tr className={showNote ? "" : "border-b border-border"}>
          <td className="py-1.5 pr-3 pl-4 font-mono text-muted-foreground text-sm">{r.code}</td>
          <td className="py-1.5 pr-3 pl-4 text-sm">{r.name}</td>
          <td className="py-1.5 pr-3 text-right tabular text-sm">
            {r.budget !== null ? fmtAUDAccounting(centsToNumber(toCents(r.budget))) : "—"}
          </td>
          <td className="py-1.5 pr-3 text-right tabular text-sm">{fmtAUDAccounting(centsToNumber(toCents(r.actual)))}</td>
          <td className={`py-1.5 pr-3 text-right tabular text-sm ${color}`}>
            {variance !== null ? fmtSigned(variance) : "—"}
          </td>
          <td className={`py-1.5 text-right tabular text-sm ${color}`}>
            {variance !== null && r.budget !== null ? fmtPct(variance, centsToNumber(toCents(r.budget))) : "—"}
            <VarianceFlag flagged={flagged} />
          </td>
        </tr>
        {showNote && (
          <tr className="border-b border-border">
            <td colSpan={6} className="pb-2 pl-4 pr-3">
              <VarianceNote year={year} accountId={r.id} initialNote={r.note} canEdit={canEditNotes} />
            </td>
          </tr>
        )}
      </React.Fragment>
    )
  }

  function renderGroupRows(groups: AccountGroup<BudgetActualRow>[], isIncome: boolean) {
    return groups.map((group) => {
      const groupBudget = centsToNumber(sumCents(group.accounts.map((r) => r.budget ?? 0)))
      const groupActual = centsToNumber(sumCents(group.accounts.map((r) => r.actual)))
      const groupVariance = centsToNumber(toCents(groupActual) - toCents(groupBudget))
      const gColor = varianceColor(groupVariance, isIncome)
      const gFlagged = isOverVarianceThreshold(groupVariance, groupBudget, varianceThresholdPct)
      return (
        <React.Fragment key={group.groupName}>
          <tr>
            <td colSpan={6} className="pt-3 pb-0.5 pl-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {group.groupName}
            </td>
          </tr>
          {group.accounts.map((r) => renderAccountRow(r, isIncome))}
          <tr className="border-b border-border bg-muted">
            <td colSpan={2} className="py-1 pr-3 pl-4 text-xs text-muted-foreground italic">{group.groupName} subtotal</td>
            <td className="py-1 pr-3 text-right tabular text-xs font-medium">{fmtAUDAccounting(groupBudget)}</td>
            <td className="py-1 pr-3 text-right tabular text-xs font-medium">{fmtAUDAccounting(groupActual)}</td>
            <td className={`py-1 pr-3 text-right tabular text-xs font-medium ${gColor}`}>{fmtSigned(groupVariance)}</td>
            <td className={`py-1 text-right tabular text-xs font-medium ${gColor}`}>
              {fmtPct(groupVariance, groupBudget)}
              <VarianceFlag flagged={gFlagged} />
            </td>
          </tr>
        </React.Fragment>
      )
    })
  }

  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm min-w-table-wide">
        <thead>
          <tr className="border-b-2 border-border">
            <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Code</th>
            <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Category</th>
            <th className="text-right py-1 pr-3 font-semibold text-muted-foreground">Budget</th>
            <th className="text-right py-1 pr-3 font-semibold text-muted-foreground">Actual</th>
            <th className="text-right py-1 pr-3 font-semibold text-muted-foreground">Variance</th>
            <th className="text-right py-1 font-semibold text-muted-foreground">%</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={6} className="pt-4 pb-1 font-bold uppercase text-xs text-muted-foreground tracking-wide">Income</td>
          </tr>
          {renderGroupRows(incomeGroups, true)}
          <tr className="border-t-2 border-border font-semibold">
            <td colSpan={2} className="py-2 pr-3">Total Income</td>
            <td className="py-2 pr-3 text-right tabular">{fmtAUDAccounting(totalIncomeBudget)}</td>
            <td className="py-2 pr-3 text-right tabular">{fmtAUDAccounting(totalIncomeActual)}</td>
            <td className={`py-2 pr-3 text-right tabular ${varianceColor(incomeVariance, true)}`}>{fmtSigned(incomeVariance)}</td>
            <td className={`py-2 text-right tabular ${varianceColor(incomeVariance, true)}`}>
              {fmtPct(incomeVariance, totalIncomeBudget)}
              <VarianceFlag flagged={isOverVarianceThreshold(incomeVariance, totalIncomeBudget, varianceThresholdPct)} />
            </td>
          </tr>

          <tr>
            <td colSpan={6} className="pt-4 pb-1 font-bold uppercase text-xs text-muted-foreground tracking-wide">Expenses</td>
          </tr>
          {renderGroupRows(expenseGroups, false)}
          <tr className="border-t-2 border-border font-semibold">
            <td colSpan={2} className="py-2 pr-3">Total Expenses</td>
            <td className="py-2 pr-3 text-right tabular">{fmtAUDAccounting(totalExpenseBudget)}</td>
            <td className="py-2 pr-3 text-right tabular">{fmtAUDAccounting(totalExpenseActual)}</td>
            <td className={`py-2 pr-3 text-right tabular ${varianceColor(expenseVariance, false)}`}>{fmtSigned(expenseVariance)}</td>
            <td className={`py-2 text-right tabular ${varianceColor(expenseVariance, false)}`}>
              {fmtPct(expenseVariance, totalExpenseBudget)}
              <VarianceFlag flagged={isOverVarianceThreshold(expenseVariance, totalExpenseBudget, varianceThresholdPct)} />
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="border-t-4 border-foreground font-bold">
            <td colSpan={2} className="pt-3 pr-3">
              Net
            </td>
            <td className="pt-3 pr-3 text-right tabular">{fmtAUDAccounting(netBudget)}</td>
            <td className="pt-3 pr-3 text-right tabular">{fmtAUDAccounting(netActual)}</td>
            <td
              className={`pt-3 pr-3 text-right tabular ${
                netVariance >= 0 ? "text-income" : "text-expense"
              }`}
            >
              {fmtSigned(netVariance)}
            </td>
            <td
              className={`pt-3 text-right tabular ${
                netVariance >= 0 ? "text-income" : "text-expense"
              }`}
            >
              {fmtPct(netVariance, netBudget)}
              <VarianceFlag flagged={isOverVarianceThreshold(netVariance, netBudget, varianceThresholdPct)} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
