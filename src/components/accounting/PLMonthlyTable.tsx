import React from "react"
import { MONTH_LABELS } from "@/lib/reports/plHelpers"
import type { AccountGroup } from "@/lib/reports/accountGrouping"
import type { PLAccountRow } from "@/lib/reports/plQuery"
import Link from "next/link"
import { PLAccountName } from "@/components/accounting/PLAccountName"
import { fmt, fmtGrid, accountTotal, plSections, plTransactionsHref } from "@/components/accounting/plFormat"
import { APP_CURRENCY } from "@/lib/appConfig"

// Category col (code inline) + 12 month cols + Total col
const MONTHLY_COLS = 1 + MONTH_LABELS.length + 1

// Category column stays pinned while the 12 months scroll sideways; it needs
// an opaque background so scrolled figures don't show through.
const STICKY = "sticky left-0 z-10"

/** Net row colour: surplus green, deficit red, zero muted. */
function netTone(v: number): string {
  if (v === 0) return "text-muted-foreground"
  return v > 0 ? "text-income" : "text-expense"
}

/** Muted en dash for zero cells, so the eye lands on real figures. */
function zeroTone(v: number): string {
  return v === 0 ? "text-muted-foreground" : ""
}

/** Per-report lookups shared by both sections of the monthly table. */
type MonthlyCtx = {
  acctMonthlyMap: Map<number, number[]>
  acctMonthlyCountMap: Map<number, number[]>
  totalMap: Map<number, number>
  year: number
}

/**
 * Renders account group rows + section total row for the monthly table.
 * A group's subtotal row is skipped when it has a single account — it would
 * only repeat that account's row.
 */
function renderMonthlyGroups(
  groups: AccountGroup<PLAccountRow>[],
  sectionMonthly: number[],
  sectionTotal: number,
  totalLabel: string,
  keyPrefix: string,
  { acctMonthlyMap, acctMonthlyCountMap, totalMap, year }: MonthlyCtx,
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
              const acctCounts = acctMonthlyCountMap.get(a.id)
              const total = accountTotal(a, totalMap)
              return (
                <tr key={a.id} className="group/row border-b border-border hover:bg-accent">
                  <td className={`${STICKY} bg-background group-hover/row:bg-accent py-1.5 pr-3 pl-4 whitespace-nowrap`}>
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{a.code}</span>
                    <PLAccountName account={a} year={year} />
                  </td>
                  {acctMonthly.map((v, i) => (
                    <td key={i} className={`py-1.5 px-2 text-right tabular whitespace-nowrap ${zeroTone(v)}`}>
                      {/* Link any month with rows — offsetting entries can net to 0. */}
                      {!acctCounts?.[i] ? (
                        fmtGrid(v)
                      ) : (
                        <Link href={plTransactionsHref(a.id, year, i)} prefetch={false} className="hover:underline">
                          {fmtGrid(v)}
                        </Link>
                      )}
                    </td>
                  ))}
                  <td className={`py-1.5 pl-3 pr-2 border-l border-border text-right tabular font-medium whitespace-nowrap ${zeroTone(total)}`}>
                    {fmtGrid(total)}
                  </td>
                </tr>
              )
            })}
            {group.accounts.length > 1 && (
              <tr className="border-b border-border bg-muted">
                <td className={`${STICKY} bg-muted py-1 pr-3 pl-4 text-xs text-muted-foreground italic whitespace-nowrap`}>
                  {group.groupName} subtotal
                </td>
                {groupMonthly.map((v, i) => (
                  <td key={i} className={`py-1 px-2 text-right tabular text-xs font-medium whitespace-nowrap ${zeroTone(v)}`}>
                    {fmtGrid(v)}
                  </td>
                ))}
                <td className={`py-1 pl-3 pr-2 border-l border-border text-right tabular text-xs font-medium whitespace-nowrap ${zeroTone(groupTotal)}`}>
                  {fmtGrid(groupTotal)}
                </td>
              </tr>
            )}
          </React.Fragment>
        )
      })}
      <tr className="border-t-2 border-border font-semibold">
        <td className={`${STICKY} bg-background py-2 pr-3 whitespace-nowrap`}>{totalLabel}</td>
        {sectionMonthly.map((v, i) => (
          <td key={i} className={`py-2 px-2 text-right tabular whitespace-nowrap ${zeroTone(v)}`}>
            {fmtGrid(v)}
          </td>
        ))}
        <td className={`py-2 pl-3 pr-2 border-l border-border text-right tabular whitespace-nowrap ${zeroTone(sectionTotal)}`}>{fmtGrid(sectionTotal)}</td>
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
  /** FY start year — scopes the account drill-down links. */
  year: number
  acctMonthlyMap: Map<number, number[]>
  acctMonthlyCountMap: Map<number, number[]>
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
  year,
  acctMonthlyMap,
  acctMonthlyCountMap,
  incomeMonthly,
  expenseMonthly,
  netMonthly,
}: Props) {
  // Dense 15-column multi-month grid. Rendered on desktop as-is; on mobile the
  // default view is the stacked per-month summary below, but this full grid
  // stays reachable on demand inside a collapsible so per-account/group detail
  // is never lost below the lg breakpoint.
  const ctx: MonthlyCtx = { acctMonthlyMap, acctMonthlyCountMap, totalMap, year }
  const sections = plSections({ incomeGroups, expenseGroups, totalIncome, totalExpenses, incomeMonthly, expenseMonthly })
  const detailTable = (
      <table className="w-full min-w-table-wide text-sm">
        <caption className="caption-bottom pt-3 text-left text-xs text-muted-foreground">
          Amounts in {APP_CURRENCY}. Categories with no transactions this financial year are hidden.
        </caption>
        <thead>
          <tr className="border-b-2 border-border">
            <th className={`${STICKY} bg-background text-left py-1 pr-3 font-semibold text-muted-foreground whitespace-nowrap`}>Category</th>
            {MONTH_LABELS.map((m) => (
              <th key={m} className="text-right py-1 px-2 font-semibold text-muted-foreground whitespace-nowrap">
                {m}
              </th>
            ))}
            <th className="text-right py-1 pl-3 pr-2 border-l border-border font-semibold text-muted-foreground whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <React.Fragment key={section.key}>
              <tr>
                <td colSpan={MONTHLY_COLS} className="pt-4 pb-1 font-bold uppercase text-xs text-muted-foreground tracking-wide">
                  {section.label}
                </td>
              </tr>
              {renderMonthlyGroups(
                section.groups,
                section.monthly,
                section.total,
                `Total ${section.label}`,
                section.key,
                ctx,
              )}
            </React.Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-4 border-foreground font-bold text-base">
            <td className={`${STICKY} bg-background pt-3 pr-3 whitespace-nowrap`}>Net Surplus / (Deficit)</td>
            {netMonthly.map((v, i) => (
              <td
                key={i}
                className={`pt-3 px-2 text-right tabular whitespace-nowrap ${netTone(v)}`}
              >
                {fmtGrid(v)}
              </td>
            ))}
            <td className={`pt-3 pl-3 pr-2 border-l border-border text-right tabular whitespace-nowrap ${netTone(net)}`}>
              {fmtGrid(net)}
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
