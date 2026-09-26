import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { safeDecrypt } from "@/lib/crypto"
import { GeneralLedgerControls } from "@/components/accounting/GeneralLedgerControls"
import { PrintButton } from "@/components/ui/PrintButton"
import { Button } from "@/components/ui/button"
import { fmtAUD as fmt, formatDMY, centsToNumber } from "@/lib/formatting"
import { withRunningBalance, signedCents } from "@/lib/generalLedgerExport"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"

type Props = { searchParams: Promise<{ account?: string; year?: string }> }

// Defensive ceiling on a single-account FY ledger listing. A running-
// balance ledger must render every row (it can't be DB-aggregated), so instead
// of an unbounded findMany we fetch at most this many rows and surface a notice
// when the account/FY has more. Never hit at parish scale — one account rarely
// clears four figures of transactions in a year — but caps the worst case.
const MAX_LEDGER_ROWS = 5000

export default async function GeneralLedgerPage(props: Props) {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "GeneralLedger", undefined, { report: "general-ledger" })

  const sp = await props.searchParams
  const fyNow = currentFYYear()
  const parsedYear = Number.parseInt(sp.year ?? String(fyNow), 10)
  const year = parsedYear >= 2000 && parsedYear <= fyNow + 10 ? parsedYear : fyNow
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  const accountId = sp.account ? Number.parseInt(sp.account, 10) : Number.NaN
  const validAccountId = !Number.isNaN(accountId) && accountId > 0 && accountId <= 2147483647 ? accountId : null

  const accounts = await prisma.account.findMany({
    orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
    select: { id: true, code: true, name: true },
  })

  const selectedAccount = validAccountId ? accounts.find((a) => a.id === validAccountId) ?? null : null

  // Fetch one past the cap so we can tell whether the listing was truncated
  // without a second count query.
  const txs = selectedAccount
    ? await prisma.transaction.findMany({
        where: { accountId: selectedAccount.id, date: { gte: fyStart, lt: fyEnd } },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: { date: true, description: true, reference: true, type: true, amount: true },
        take: MAX_LEDGER_ROWS + 1,
      })
    : []

  const truncated = txs.length > MAX_LEDGER_ROWS
  const shownTxs = truncated ? txs.slice(0, MAX_LEDGER_ROWS) : txs

  const rows = withRunningBalance(
    shownTxs.map((t) => ({
      date: t.date,
      description: safeDecrypt(t.description),
      reference: t.reference,
      type: t.type as "INCOME" | "EXPENSE",
      amount: t.amount,
    })),
  )

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 print:hidden">
        <h2 className="text-2xl font-semibold text-foreground">General Ledger — FY {year}–{year + 1}</h2>
        <div className="flex items-center gap-3">
          <GeneralLedgerControls accounts={accounts} accountId={validAccountId} year={year} />
          {selectedAccount && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/api/accounting/reports/general-ledger/export-csv?account=${selectedAccount.id}&year=${year}`}>
                Export CSV
              </Link>
            </Button>
          )}
          <PrintButton />
        </div>
      </div>
      <h2 className="hidden print:block text-xl font-semibold mb-4">
        General Ledger{selectedAccount ? ` — ${selectedAccount.code} ${selectedAccount.name}` : ""} — FY {year}–{year + 1}
      </h2>

      {!selectedAccount ? (
        <p className="text-sm text-muted-foreground">Select an account to view its ledger.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No transactions for {selectedAccount.code} {selectedAccount.name} in FY {year}–{year + 1}.
        </p>
      ) : (
        <>
          {truncated && (
            <p className="mb-2 text-sm text-warning bg-warning/10 border border-warning/40 rounded px-3 py-2">
              Showing the earliest {MAX_LEDGER_ROWS.toLocaleString()} transactions for this
              account in FY {year}–{year + 1}. Later transactions are not shown — export the
              CSV or narrow the year to see the full ledger.
            </p>
          )}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-table-wide text-sm">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Date</th>
                  <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Description</th>
                  <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Reference</th>
                  <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Amount</th>
                  <th className="text-right py-2 font-semibold text-muted-foreground">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDMY(r.date)}</td>
                    <td className="py-2 pr-3">{r.description}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.reference ?? "—"}</td>
                    <td className={`py-2 pr-3 text-right tabular ${r.type === "INCOME" ? "text-income" : "text-expense"}`}>
                      {fmt(centsToNumber(signedCents(r.type, r.amount)))}
                    </td>
                    <td className="py-2 text-right tabular font-medium">{fmt(centsToNumber(r.balanceCents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {rows.length === 0 && (
              <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                No transactions found
              </li>
            )}
            {rows.map((r, i) => (
              <li key={i} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{r.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDMY(r.date)} · {r.reference ?? "—"}
                    </p>
                  </div>
                  <span className={`shrink-0 tabular font-semibold whitespace-nowrap ${r.type === "INCOME" ? "text-income" : "text-expense"}`}>
                    {fmt(centsToNumber(signedCents(r.type, r.amount)))}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-xs">
                  <span className="text-muted-foreground">Running Balance</span>
                  <span className="tabular font-medium">{fmt(centsToNumber(r.balanceCents))}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
