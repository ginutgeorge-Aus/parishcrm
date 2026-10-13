import React from "react"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { auditIpFromHeaders } from "@/lib/clientIp"
import { MONTH_LABELS } from "@/lib/reports/plHelpers"
import { centsToNumber, fmtAUDAccounting, MONTH_ABBR } from "@/lib/formatting"
import { fyRangeLabel } from "@/lib/fiscalYear"
import { getPLReportData, resolvePLYear } from "@/lib/reports/plQuery"
import { sydneyParts } from "@/lib/dates"
import { DEFAULT_CHURCH_NAME } from "@/lib/settingsConstants"
import { PrintButton } from "@/components/ui/PrintButton"

type Props = {
  searchParams: Promise<{ year?: string; view?: string }>
}

// Takes integer cents — same accumulation path as the on-screen report,
// so print and screen totals are identical to the cent.
function fmt(cents: number): string {
  return fmtAUDAccounting(centsToNumber(cents))
}

export default async function PLPrintPage(props: Readonly<Props>) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!session) redirect("/login")
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const headersList = await headers()
  const userId = actorId(session)
  void logAudit(userId, "EXPORT_FINANCIAL_REPORT", "Transaction", undefined, { report: "pl-print" }, auditIpFromHeaders(headersList))

  // Production CSP nonces style-src; the print <style> needs the nonce.
  const nonce = headersList.get("x-nonce") ?? undefined

  // Shared guard: rejects a malformed ?year= (e.g. "2024junk") instead
  // of parseInt truncating it to a valid-looking year.
  const year = resolvePLYear(searchParams.year)
  const isMonthly = searchParams.view === "monthly"
  const generated = sydneyParts()

  const churchSetting = await prisma.appSetting.findUnique({ where: { key: "churchName" } })
  const churchName = churchSetting?.value ?? process.env.CHURCH_NAME ?? DEFAULT_CHURCH_NAME

  // Same query + aggregation as the on-screen report, so print and screen
  // totals cannot drift (XFER exclusion, FY range, monthly sums).
  const {
    incomeGroups, expenseGroups, totalMap, totalIncome, totalExpenses, net,
    acctMonthlyMap, incomeMonthly, expenseMonthly, netMonthly,
  } = await getPLReportData(year, isMonthly)

  /** Annual total (integer cents) for one account; 0 when it has no transactions. */
  const accountTotal = (a: { id: number }): number => totalMap.get(a.id) ?? 0

  const MONTHLY_COLS = 2 + MONTH_LABELS.length + 1

  type Group = (typeof incomeGroups)[number]

  /**
   * Monthly-view rows for one section's groups: a header, one row per account
   * with 12 month columns + total, and a subtotal. Keyed by the group's first
   * account id (stable and unique — an account belongs to one group).
   */
  const renderMonthlyGroups = (groups: Group[], prefix: string) =>
    groups.map((group) => {
      const gMonthly = group.accounts.reduce(
        (acc, a) => acc.map((v, i) => v + (acctMonthlyMap.get(a.id) ?? new Array<number>(12).fill(0))[i]),
        new Array<number>(12).fill(0),
      )
      const gTotal = group.accounts.reduce((s, a) => s + accountTotal(a), 0)
      return (
        <React.Fragment key={`${prefix}-${group.accounts[0].id}`}>
          <tr className="group-header"><td colSpan={MONTHLY_COLS}>{group.groupName}</td></tr>
          {group.accounts.map((a) => (
            <tr key={a.id} className="account">
              <td style={{ fontFamily: "monospace", color: "var(--c-meta)" }}>{a.code}</td>
              <td>{a.name}{!a.isActive ? " (inactive)" : ""}</td>
              {(acctMonthlyMap.get(a.id) ?? new Array<number>(12).fill(0)).map((v, i) => <td key={i} className="r">{fmt(v)}</td>)}
              <td className="r" style={{ fontWeight: 600 }}>{fmt(accountTotal(a))}</td>
            </tr>
          ))}
          <tr className="group-total">
            <td colSpan={2} style={{ paddingInlineStart: 20 }}>{group.groupName} subtotal</td>
            {gMonthly.map((v, i) => <td key={i} className="r">{fmt(v)}</td>)}
            <td className="r" style={{ fontWeight: 600 }}>{fmt(gTotal)}</td>
          </tr>
        </React.Fragment>
      )
    })

  /** Annual-view rows for one section's groups (same shape, one Actual column). */
  const renderAnnualGroups = (groups: Group[], prefix: string) =>
    groups.map((group) => {
      const gTotal = group.accounts.reduce((s, a) => s + accountTotal(a), 0)
      return (
        <React.Fragment key={`${prefix}-${group.accounts[0].id}`}>
          <tr className="group-header"><td colSpan={3}>{group.groupName}</td></tr>
          {group.accounts.map((a) => (
            <tr key={a.id} className="account">
              <td style={{ fontFamily: "monospace", color: "var(--c-meta)" }}>{a.code}</td>
              <td>{a.name}{!a.isActive ? " (inactive)" : ""}</td>
              <td className="r">{fmt(accountTotal(a))}</td>
            </tr>
          ))}
          <tr className="group-total">
            <td colSpan={2} style={{ paddingInlineStart: 20 }}>{group.groupName} subtotal</td>
            <td className="r">{fmt(gTotal)}</td>
          </tr>
        </React.Fragment>
      )
    })

  return (
    <>
      <div className="print:hidden">
        <PrintButton />
      </div>
      <style nonce={nonce}>{`
        /* Print-scoped palette — CSS vars defined here apply reliably in @media print (unlike app :root tokens). */
        :root { --c-meta: #666; --c-rule-strong: #333; --c-rule: #eee; --c-rule-mid: #999; --c-label: #555; --c-label-dim: #888; --c-zebra: #f8f8f8; --c-pos: #166534; --c-neg: #991b1b; }
        body { font-family: sans-serif; font-size: 11px; margin: 24px; }
        h1 { font-size: 16px; margin-bottom: 2px; }
        .meta { color: var(--c-meta); font-size: 10px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { border-bottom: 2px solid var(--c-rule-strong); padding: 4px 6px; text-align: start; font-size: 10px; }
        th.r, td.r { text-align: end; }
        td { padding: 3px 6px; border-bottom: 1px solid var(--c-rule); }
        .section-header td { padding-top: 12px; padding-bottom: 2px; font-weight: 700; text-transform: uppercase; font-size: 10px; color: var(--c-label); letter-spacing: 0.05em; border-bottom: none; }
        .group-header td { padding-top: 6px; padding-bottom: 1px; padding-inline-start: 12px; font-weight: 600; font-size: 10px; color: var(--c-label-dim); text-transform: uppercase; letter-spacing: 0.04em; border-bottom: none; }
        .account td { padding-inline-start: 20px; }
        .group-total td { background: var(--c-zebra); font-style: italic; font-size: 10px; }
        .section-total td { font-weight: 700; border-top: 2px solid var(--c-rule-mid); border-bottom: none; }
        .net td { font-weight: 700; font-size: 13px; border-top: 3px solid var(--c-rule-strong); border-bottom: none; padding-top: 6px; }
        .positive { color: var(--c-pos); }
        .negative { color: var(--c-neg); }
        @media print { body { margin: 0; } ${isMonthly ? "@page { size: landscape; }" : ""} }
      `}</style>

      <h1>P&amp;L Report — FY {fyRangeLabel(year)}{isMonthly ? " (Monthly)" : ""}</h1>
      <p className="meta">
        {churchName} · Generated: {generated.day} {MONTH_ABBR[generated.month - 1]} {generated.year}
      </p>

      {isMonthly ? (
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Category</th>
              {MONTH_LABELS.map((m) => <th key={m} className="r">{m}</th>)}
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="section-header"><td colSpan={MONTHLY_COLS}>Income</td></tr>
            {renderMonthlyGroups(incomeGroups, "ig")}
            <tr className="section-total">
              <td colSpan={2}>Total Income</td>
              {incomeMonthly.map((v, i) => <td key={i} className="r">{fmt(v)}</td>)}
              <td className="r">{fmt(totalIncome)}</td>
            </tr>

            <tr className="section-header"><td colSpan={MONTHLY_COLS}>Expenses</td></tr>
            {renderMonthlyGroups(expenseGroups, "eg")}
            <tr className="section-total">
              <td colSpan={2}>Total Expenses</td>
              {expenseMonthly.map((v, i) => <td key={i} className="r">{fmt(v)}</td>)}
              <td className="r">{fmt(totalExpenses)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className={`net ${net >= 0 ? "positive" : "negative"}`}>
              <td colSpan={2}>Net Surplus / (Deficit)</td>
              {netMonthly.map((v, i) => <td key={i} className="r">{fmt(v)}</td>)}
              <td className="r">{fmt(net)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Category</th>
              <th className="r">Actual</th>
            </tr>
          </thead>
          <tbody>
            <tr className="section-header"><td colSpan={3}>Income</td></tr>
            {renderAnnualGroups(incomeGroups, "ig")}
            <tr className="section-total">
              <td colSpan={2}>Total Income</td>
              <td className="r">{fmt(totalIncome)}</td>
            </tr>

            <tr className="section-header"><td colSpan={3}>Expenses</td></tr>
            {renderAnnualGroups(expenseGroups, "eg")}
            <tr className="section-total">
              <td colSpan={2}>Total Expenses</td>
              <td className="r">{fmt(totalExpenses)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className={`net ${net >= 0 ? "positive" : "negative"}`}>
              <td colSpan={2}>Net Surplus / (Deficit)</td>
              <td className="r">{fmt(net)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </>
  )
}
