import React from "react"
import { MONTH_LABELS } from "@/lib/reports/plHelpers"
import type { AccountGroup } from "@/lib/reports/accountGrouping"
import type { PLAccountRow } from "@/lib/reports/plQuery"
import Link from "next/link"
import { PLAccountName } from "@/components/accounting/PLAccountName"
import { fmt, fmtGrid, accountTotal, plSections, plTone, plTransactionsHref } from "@/components/accounting/plFormat"
import { APP_CURRENCY } from "@/lib/appConfig"
import { EmptyState } from "@/components/shared/EmptyState"
import { BarChart2 } from "lucide-react"

// Category col (code inline) + 12 month cols + Total col
const MONTHLY_COLS = 1 + MONTH_LABELS.length + 1

// Category column stays pinned while the 12 months scroll sideways on desktop;
// it needs an opaque background so scrolled figures don't show through. Below
// lg (the on-demand grid inside <details>) it scrolls with the row, since a
// long pinned name would eat most of a 375px screen.
const STICKY = "lg:sticky lg:left-0 lg:z-10"

// Group-name header rows (colSpan): label pinned the same way, offset by the
// cell's pl-2, so group names stay in view while the months scroll. Section
// headers do the same with no offset.
const STICKY_LABEL = "inline-block lg:sticky lg:left-2"

const NET_TONE = { zero: "text-muted-foreground", positive: "text-income", negative: "text-expense" } as const

/** Net row colour: surplus green, deficit red, zero muted. */
const netTone = (v: number): string => {
  return NET_TONE[plTone(v)]
}

/** Muted en dash for zero cells, so the eye lands on real figures. */
const zeroTone = (v: number): string => {
  return plTone(v) === "zero" ? "text-muted-foreground" : ""
}

/** Mobile month-card figure: full currency format, en dash for an empty month. */
const fmtCard = (v: number): string => {
  return v === 0 ? "–" : fmt(v)
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
const renderMonthlyGroups = (
  groups: AccountGroup<PLAccountRow>[],
  sectionMonthly: number[],
  sectionTotal: number,
  totalLabel: string,
  keyPrefix: string,
  { acctMonthlyMap, acctMonthlyCountMap, totalMap, year }: MonthlyCtx,
): React.ReactNode => {
  return (
    <>
      {groups.map((group) => {
        const groupMonthly = group.accounts.reduce(
          (acc, a) => acc.map((v, i) => v + (acctMonthlyMap.get(a.id)?.[i] ?? 0)),
          new Array<number>(12).fill(0),
        )
        const groupTotal = group.accounts.reduce((s, a) => s + accountTotal(a, totalMap), 0)
        // Keyed by first account id: unique, unlike group names ("Other" can repeat).
        return (
          <React.Fragment key={`${keyPrefix}-${group.accounts[0].id}`}>
            <tr>
              <td colSpan={MONTHLY_COLS} className="pt-3 pb-0.5 pl-2 text-xs font-semibold text-muted-foreground">
                <span className={STICKY_LABEL}>{group.groupName}</span>
              </td>
            </tr>
            {group.accounts.map((a) => {
              const acctMonthly = acctMonthlyMap.get(a.id) ?? new Array<number>(12).fill(0)
              const acctCounts = acctMonthlyCountMap.get(a.id)
              const total = accountTotal(a, totalMap)
              return (
                <tr key={a.id} className="group/row *:border-b *:border-b-border hover:bg-accent">
                  <td className={`${STICKY} bg-background group-hover/row:bg-accent py-1.5 pr-3 pl-4 whitespace-nowrap`}>
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{a.code}</span>
                    <PLAccountName account={a} year={year} />
                  </td>
                  {acctMonthly.map((v, i) => (
                    <td key={MONTH_LABELS[i]} className={`py-1.5 px-2 text-right tabular whitespace-nowrap ${zeroTone(v)}`}>
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
              <tr className="*:border-b *:border-b-border bg-muted">
                <td className={`${STICKY} bg-muted py-1 pr-3 pl-4 text-xs text-muted-foreground italic whitespace-nowrap`}>
                  {group.groupName} subtotal
                </td>
                {groupMonthly.map((v, i) => (
                  <td key={MONTH_LABELS[i]} className={`py-1 px-2 text-right tabular text-xs font-medium whitespace-nowrap ${zeroTone(v)}`}>
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
      <tr className="*:border-t *:border-t-border font-semibold">
        <td className={`${STICKY} bg-background py-2 pr-3 whitespace-nowrap`}>{totalLabel}</td>
        {sectionMonthly.map((v, i) => (
          <td key={MONTH_LABELS[i]} className={`py-2 px-2 text-right tabular whitespace-nowrap ${zeroTone(v)}`}>
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
  // The grid hides categories with no transactions, so an empty FY would show
  // only headers and dashes.
  if (incomeGroups.length === 0 && expenseGroups.length === 0) {
    return (
      <EmptyState
        icon={BarChart2}
        title="No income or expenses this financial year"
        description="Income and expenses appear here month by month once they are recorded for this year."
        headingLevel={3}
        className="m-4"
      />
    )
  }
  const ctx: MonthlyCtx = { acctMonthlyMap, acctMonthlyCountMap, totalMap, year }
  const sections = plSections({ incomeGroups, expenseGroups, totalIncome, totalExpenses, incomeMonthly, expenseMonthly })
  const detailTable = (
      // border-separate: with collapsed borders, row borders detach from the
      // sticky Category cells while scrolling. Borders sit on the cells (`*:`),
      // since rows can't draw borders in the separate model. Borders no longer
      // merge, so a section total's 1px top rule stacks on the row above's 1px
      // bottom rule to give the old 2px line.
      <table className="w-full min-w-table-wide border-separate border-spacing-0 text-sm">
        <caption className="caption-bottom pt-3 text-left text-xs text-muted-foreground">
          Amounts in {APP_CURRENCY}. Categories with no transactions this financial year are hidden.
        </caption>
        <thead>
          <tr className="*:border-b-2 *:border-b-border">
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
                <td colSpan={MONTHLY_COLS} className="pt-4 pb-1 font-bold text-xs text-muted-foreground">
                  <span className="inline-block lg:sticky lg:left-0">{section.label}</span>
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
          <tr className="*:border-t-4 *:border-t-foreground font-bold text-base">
            <td className={`${STICKY} bg-background pt-3 pr-3 whitespace-nowrap`}>Net Surplus / (Deficit)</td>
            {netMonthly.map((v, i) => (
              <td
                key={MONTH_LABELS[i]}
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
            <div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">
              {m}
            </div>
            <div className="grid grid-cols-2 gap-y-1 px-3 py-2 text-sm">
              <div>
                <span className="text-muted-foreground">Income</span>
                <div className={`text-right tabular ${zeroTone(incomeMonthly[i])}`}>{fmtCard(incomeMonthly[i])}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Expenses</span>
                <div className={`text-right tabular ${zeroTone(expenseMonthly[i])}`}>{fmtCard(expenseMonthly[i])}</div>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Net</span>
                <div
                  className={`text-right tabular font-medium ${netTone(netMonthly[i])}`}
                >
                  {fmtCard(netMonthly[i])}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-border">
          <div className="border-b border-border bg-muted px-3 py-2 text-xs font-semibold">
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
                className={`text-right tabular font-medium ${netTone(net)}`}
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
