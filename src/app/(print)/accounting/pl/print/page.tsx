import React from "react"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { auditIpFromHeaders } from "@/lib/clientIp"
import { monthlyAmounts, MONTH_LABELS } from "@/lib/reports/plHelpers"
import { toCents, centsToNumber, fmtAUDAccounting, MONTH_ABBR } from "@/lib/formatting"
import { fyDateRange } from "@/lib/fiscalYear"
import { resolvePLYear } from "@/lib/reports/plQuery"
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

type AccountRow = {
  id: number
  code: string
  name: string
  isActive: boolean
  group: { id: number; name: string; sortOrder: number } | null
  transactions: { amount: { toString(): string }; date: Date }[]
}

type AccountGroup = { groupName: string; sortOrder: number; accounts: AccountRow[] }

function groupByAccountGroup(accounts: AccountRow[]): AccountGroup[] {
  const map = new Map<string, AccountGroup>()
  for (const a of accounts) {
    // Key by group id, not name: AccountGroup's unique key is (name,
    // type), so two distinct groups can share a display name and must not merge.
    const key = a.group ? `id:${a.group.id}` : "__ungrouped__"
    const sortOrder = a.group?.sortOrder ?? 999
    if (!map.has(key)) map.set(key, { groupName: a.group?.name ?? "Other", sortOrder, accounts: [] })
    map.get(key)!.accounts.push(a)
  }
  return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder)
}

function accountTotal(a: AccountRow): number {
  return a.transactions.reduce((s, t) => s + toCents(t.amount), 0)
}

export default async function PLPrintPage(props: Props) {
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

  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  const accounts = await prisma.account.findMany({
    where: {
      // Exclude the internal-transfer clearing account — mirrors the
      // on-screen P&L; XFER's transfer legs are not real income/expense.
      code: { not: "XFER" },
      OR: [
        { isActive: true },
        { transactions: { some: { date: { gte: fyStart, lt: fyEnd } } } },
      ],
    },
    orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
    include: {
      group: { select: { id: true, name: true, sortOrder: true } },
      transactions: {
        where: { date: { gte: fyStart, lt: fyEnd } },
        select: { amount: true, date: true },
      },
    },
  })

  const incomeAccounts = accounts.filter((a) => a.type === "INCOME")
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE")
  const incomeGroups = groupByAccountGroup(incomeAccounts)
  const expenseGroups = groupByAccountGroup(expenseAccounts)

  const totalIncome = incomeAccounts.reduce((s, a) => s + accountTotal(a), 0)
  const totalExpenses = expenseAccounts.reduce((s, a) => s + accountTotal(a), 0)
  const net = totalIncome - totalExpenses

  const acctMonthlyMap: Map<number, number[]> = isMonthly
    ? new Map(accounts.map((a) => [a.id, monthlyAmounts(a.transactions)]))
    : new Map()

  const sumMonthly = (accs: AccountRow[]): number[] =>
    accs.reduce(
      (acc, a) => acc.map((v, i) => v + (acctMonthlyMap.get(a.id)?.[i] ?? 0)),
      new Array<number>(12).fill(0),
    )

  const incomeMonthly = isMonthly ? sumMonthly(incomeAccounts) : []
  const expenseMonthly = isMonthly ? sumMonthly(expenseAccounts) : []
  const netMonthly = isMonthly ? incomeMonthly.map((v, i) => v - expenseMonthly[i]) : []

  const MONTHLY_COLS = 2 + MONTH_LABELS.length + 1

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

      <h1>P&amp;L Report — FY {year}–{year + 1}{isMonthly ? " (Monthly)" : ""}</h1>
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
            {incomeGroups.map((group, gi) => {
              const gMonthly = group.accounts.reduce(
                (acc, a) => acc.map((v, i) => v + (acctMonthlyMap.get(a.id) ?? new Array<number>(12).fill(0))[i]),
                new Array<number>(12).fill(0),
              )
              const gTotal = group.accounts.reduce((s, a) => s + accountTotal(a), 0)
              return (
                <React.Fragment key={`ig-`}>
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
            })}
            <tr className="section-total">
              <td colSpan={2}>Total Income</td>
              {incomeMonthly.map((v, i) => <td key={i} className="r">{fmt(v)}</td>)}
              <td className="r">{fmt(totalIncome)}</td>
            </tr>

            <tr className="section-header"><td colSpan={MONTHLY_COLS}>Expenses</td></tr>
            {expenseGroups.map((group, gi) => {
              const gMonthly = group.accounts.reduce(
                (acc, a) => acc.map((v, i) => v + (acctMonthlyMap.get(a.id) ?? new Array<number>(12).fill(0))[i]),
                new Array<number>(12).fill(0),
              )
              const gTotal = group.accounts.reduce((s, a) => s + accountTotal(a), 0)
              return (
                <React.Fragment key={`eg-`}>
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
            })}
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
            {incomeGroups.map((group, gi) => {
              const gTotal = group.accounts.reduce((s, a) => s + accountTotal(a), 0)
              return (
                <React.Fragment key={`ig-`}>
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
            })}
            <tr className="section-total">
              <td colSpan={2}>Total Income</td>
              <td className="r">{fmt(totalIncome)}</td>
            </tr>

            <tr className="section-header"><td colSpan={3}>Expenses</td></tr>
            {expenseGroups.map((group, gi) => {
              const gTotal = group.accounts.reduce((s, a) => s + accountTotal(a), 0)
              return (
                <React.Fragment key={`eg-`}>
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
            })}
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
