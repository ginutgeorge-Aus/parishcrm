import React from "react"
import type { AccountGroup } from "@/lib/reports/accountGrouping"
import type { PLAccountRow } from "@/lib/reports/plQuery"
import { PLAccountName } from "@/components/accounting/PLAccountName"
import { fmt, accountTotal, plSections } from "@/components/accounting/plFormat"

type Props = {
  incomeGroups: AccountGroup<PLAccountRow>[]
  expenseGroups: AccountGroup<PLAccountRow>[]
  totalMap: Map<number, number>
  totalIncome: number
  totalExpenses: number
  net: number
  /** FY start year — scopes the account drill-down links. */
  year: number
}

export function PLAnnualTable({
  incomeGroups,
  expenseGroups,
  totalMap,
  totalIncome,
  totalExpenses,
  net,
  year,
}: Readonly<Props>) {
  const sections = plSections({ incomeGroups, expenseGroups, totalIncome, totalExpenses })
  return (
    // Desktop: full table
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-table-narrow text-sm">
        <thead>
          <tr className="border-b-2 border-border">
            <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Code</th>
            <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Category</th>
            <th className="text-right py-1 font-semibold text-muted-foreground">Actual</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <React.Fragment key={section.key}>
              <tr>
                <td colSpan={3} className="pt-4 pb-1 font-bold uppercase text-xs text-muted-foreground tracking-wide">
                  {section.label}
                </td>
              </tr>
              {section.groups.map((group) => {
                const groupTotal = group.accounts.reduce((s, a) => s + accountTotal(a, totalMap), 0)
                return (
                  <React.Fragment key={`${section.key}-${group.groupName}`}>
                    <tr>
                      <td colSpan={3} className="pt-3 pb-0.5 pl-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {group.groupName}
                      </td>
                    </tr>
                    {group.accounts.map((a) => (
                      <tr key={a.id} className="border-b border-border">
                        <td className="py-1.5 pr-3 pl-4 font-mono text-muted-foreground">{a.code}</td>
                        <td className="py-1.5 pr-3 pl-4">
                          <PLAccountName account={a} year={year} />
                        </td>
                        <td className="py-1.5 text-right tabular">{fmt(accountTotal(a, totalMap))}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-border bg-muted">
                      <td colSpan={2} className="py-1 pr-3 pl-4 text-xs text-muted-foreground italic">
                        {group.groupName} subtotal
                      </td>
                      <td className="py-1 text-right tabular text-xs font-medium">{fmt(groupTotal)}</td>
                    </tr>
                  </React.Fragment>
                )
              })}
              <tr className="border-t-2 border-border font-semibold">
                <td colSpan={2} className="py-2 pr-3">Total {section.label}</td>
                <td className="py-2 text-right tabular">{fmt(section.total)}</td>
              </tr>
            </React.Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-4 border-foreground font-bold text-base">
            <td colSpan={2} className="pt-3 pr-3">Net Surplus / (Deficit)</td>
            <td className={`pt-3 text-right tabular ${net >= 0 ? "text-income" : "text-expense"}`}>
              {fmt(net)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
