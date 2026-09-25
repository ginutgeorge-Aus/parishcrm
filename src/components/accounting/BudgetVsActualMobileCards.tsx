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

export function BudgetVsActualMobileCards({
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
  // Mobile card equivalents — same underlying rows/totals as the desktop
  // table, stacked instead of laid out in columns.
  function renderAccountCard(r: BudgetActualRow, isIncome: boolean) {
    const variance = r.budget !== null ? centsToNumber(toCents(r.actual) - toCents(r.budget)) : null
    const color = variance !== null ? varianceColor(variance, isIncome) : "text-gray-400"
    const budgetNum = r.budget !== null ? centsToNumber(toCents(r.budget)) : 0
    const flagged = variance !== null && isOverVarianceThreshold(variance, budgetNum, varianceThresholdPct)
    const showNote = r.budget !== null && (canEditNotes ? flagged || Boolean(r.note) : Boolean(r.note))
    return (
      <li key={r.id} className="rounded-md border bg-card p-2.5 text-sm">
        <p className="min-w-0 truncate">
          <span className="mr-1 font-mono text-xs text-muted-foreground">{r.code}</span>
          {r.name}
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">Budget</span>
          <span className="text-right tabular">{r.budget !== null ? fmtAUDAccounting(centsToNumber(toCents(r.budget))) : "—"}</span>
          <span className="text-muted-foreground">Actual</span>
          <span className="text-right tabular">{fmtAUDAccounting(centsToNumber(toCents(r.actual)))}</span>
          <span className="text-muted-foreground">Variance</span>
          <span className={`text-right tabular ${color}`}>{variance !== null ? fmtSigned(variance) : "—"}</span>
          <span className="text-muted-foreground">%</span>
          <span className={`text-right tabular ${color}`}>
            {variance !== null && r.budget !== null ? fmtPct(variance, centsToNumber(toCents(r.budget))) : "—"}
            <VarianceFlag flagged={flagged} />
          </span>
        </div>
        {showNote && (
          <VarianceNote year={year} accountId={r.id} initialNote={r.note} canEdit={canEditNotes} />
        )}
      </li>
    )
  }

  function renderGroupCards(groups: AccountGroup<BudgetActualRow>[], isIncome: boolean) {
    return groups.map((group) => {
      const groupBudget = centsToNumber(sumCents(group.accounts.map((r) => r.budget ?? 0)))
      const groupActual = centsToNumber(sumCents(group.accounts.map((r) => r.actual)))
      const groupVariance = centsToNumber(toCents(groupActual) - toCents(groupBudget))
      const gColor = varianceColor(groupVariance, isIncome)
      const gFlagged = isOverVarianceThreshold(groupVariance, groupBudget, varianceThresholdPct)
      return (
        <li key={group.groupName} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.groupName}</p>
          <ul className="space-y-2">{group.accounts.map((r) => renderAccountCard(r, isIncome))}</ul>
          <div className="rounded-md bg-muted p-2.5 text-xs font-medium">
            <p className="text-muted-foreground italic">{group.groupName} subtotal</p>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              <span className="text-muted-foreground">Budget</span>
              <span className="text-right tabular">{fmtAUDAccounting(groupBudget)}</span>
              <span className="text-muted-foreground">Actual</span>
              <span className="text-right tabular">{fmtAUDAccounting(groupActual)}</span>
              <span className="text-muted-foreground">Variance</span>
              <span className={`text-right tabular ${gColor}`}>{fmtSigned(groupVariance)}</span>
              <span className="text-muted-foreground">%</span>
              <span className={`text-right tabular ${gColor}`}>
                {fmtPct(groupVariance, groupBudget)}
                <VarianceFlag flagged={gFlagged} />
              </span>
            </div>
          </div>
        </li>
      )
    })
  }

  return (
    <div className="space-y-4 md:hidden">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Income</p>
        <ul className="space-y-3">{renderGroupCards(incomeGroups, true)}</ul>
        <div className="mt-2 rounded-lg bg-secondary p-3 text-sm font-semibold">
          <p>Total Income</p>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-normal">
            <span className="text-muted-foreground">Budget</span>
            <span className="text-right tabular">{fmtAUDAccounting(totalIncomeBudget)}</span>
            <span className="text-muted-foreground">Actual</span>
            <span className="text-right tabular">{fmtAUDAccounting(totalIncomeActual)}</span>
            <span className="text-muted-foreground">Variance</span>
            <span className={`text-right tabular ${varianceColor(incomeVariance, true)}`}>{fmtSigned(incomeVariance)}</span>
            <span className="text-muted-foreground">%</span>
            <span className={`text-right tabular ${varianceColor(incomeVariance, true)}`}>
              {fmtPct(incomeVariance, totalIncomeBudget)}
              <VarianceFlag flagged={isOverVarianceThreshold(incomeVariance, totalIncomeBudget, varianceThresholdPct)} />
            </span>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Expenses</p>
        <ul className="space-y-3">{renderGroupCards(expenseGroups, false)}</ul>
        <div className="mt-2 rounded-lg bg-secondary p-3 text-sm font-semibold">
          <p>Total Expenses</p>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-normal">
            <span className="text-muted-foreground">Budget</span>
            <span className="text-right tabular">{fmtAUDAccounting(totalExpenseBudget)}</span>
            <span className="text-muted-foreground">Actual</span>
            <span className="text-right tabular">{fmtAUDAccounting(totalExpenseActual)}</span>
            <span className="text-muted-foreground">Variance</span>
            <span className={`text-right tabular ${varianceColor(expenseVariance, false)}`}>{fmtSigned(expenseVariance)}</span>
            <span className="text-muted-foreground">%</span>
            <span className={`text-right tabular ${varianceColor(expenseVariance, false)}`}>
              {fmtPct(expenseVariance, totalExpenseBudget)}
              <VarianceFlag flagged={isOverVarianceThreshold(expenseVariance, totalExpenseBudget, varianceThresholdPct)} />
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-3 text-base font-bold">
        <p>Net</p>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm font-normal">
          <span className="text-muted-foreground">Budget</span>
          <span className="text-right tabular">{fmtAUDAccounting(netBudget)}</span>
          <span className="text-muted-foreground">Actual</span>
          <span className="text-right tabular">{fmtAUDAccounting(netActual)}</span>
          <span className="text-muted-foreground">Variance</span>
          <span className={`text-right tabular ${netVariance >= 0 ? "text-income" : "text-expense"}`}>{fmtSigned(netVariance)}</span>
          <span className="text-muted-foreground">%</span>
          <span className={`text-right tabular ${netVariance >= 0 ? "text-income" : "text-expense"}`}>
            {fmtPct(netVariance, netBudget)}
            <VarianceFlag flagged={isOverVarianceThreshold(netVariance, netBudget, varianceThresholdPct)} />
          </span>
        </div>
      </div>
    </div>
  )
}
