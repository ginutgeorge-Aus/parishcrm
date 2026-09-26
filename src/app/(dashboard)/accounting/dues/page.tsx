import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { toFloat } from "@/lib/utils"
import { fmtAUD as fmt, centsToNumber, toCents } from "@/lib/formatting"
import { YearSelector } from "@/components/accounting/YearSelector"
import { PrintButton } from "@/components/ui/PrintButton"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { computeFamilyDues } from "@/lib/reports/duesHelpers"

// The income account that subscription payments are booked against (seeded as
// "Church Subscription Fees"). Resolved by code so a renamed account still works.
const SUBSCRIPTION_ACCOUNT_CODE = "4001"

type Props = {
  searchParams: Promise<{ year?: string; filter?: string }>
}

export default async function DuesReportPage(props: Props) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  // Page view, not an export.
  void logAudit(
    actorId(session),
    "VIEW_FINANCIAL_REPORT",
    "Dues",
    undefined,
    { report: "dues" }
  )

  const fyNow = currentFYYear()
  const parsedYear = Number.parseInt(searchParams.year ?? String(fyNow), 10)
  const year = parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : fyNow
  const owingOnly = searchParams.filter === "owing"

  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  const [subAccount, families] = await Promise.all([
    prisma.account.findUnique({
      where: { code: SUBSCRIPTION_ACCOUNT_CODE },
      select: { id: true },
    }),
    prisma.family.findMany({
      where: { monthlyDues: { not: null }, archivedAt: null },
      select: { id: true, name: true, memberNo: true, joinedDate: true, monthlyDues: true },
      orderBy: { name: "asc" },
    }),
  ])

  // Sum each subscribing family's subscription income within the FY, in one query.
  const paidGroups = subAccount
    ? await prisma.transaction.groupBy({
        by: ["familyId"],
        where: {
          accountId: subAccount.id,
          type: TransactionType.INCOME,
          date: { gte: fyStart, lt: fyEnd },
          familyId: { in: families.map((f) => f.id) },
        },
        _sum: { amount: true },
      })
    : []
  const paidMap = new Map<number, number>(
    paidGroups
      .filter((g) => g.familyId != null)
      .map((g) => [g.familyId!, toFloat(g._sum.amount ?? 0)]),
  )

  const rows = families
    .map((f) => {
      const dues = computeFamilyDues(
        {
          monthlyDues: f.monthlyDues != null ? toFloat(f.monthlyDues) : null,
          joinedDate: f.joinedDate,
          paidTotal: paidMap.get(f.id) ?? 0,
        },
        year,
      )
      return { ...f, monthly: f.monthlyDues != null ? toFloat(f.monthlyDues) : 0, ...dues }
    })
    .filter((r) => (owingOnly ? r.due > 0 : true))

  // Accumulate the totals row in integer cents to avoid float drift;
  // each per-family figure is already exact to the cent. Use toCents rather than
  // Math.round(x*100) so there is a single float→int conversion point.
  const totalCents = rows.reduce(
    (acc, r) => ({
      expected: acc.expected + toCents(r.expected),
      paid: acc.paid + toCents(r.paid),
      due: acc.due + toCents(r.due),
    }),
    { expected: 0, paid: 0, due: 0 },
  )
  const totals = {
    expected: centsToNumber(totalCents.expected),
    paid: centsToNumber(totalCents.paid),
    due: centsToNumber(totalCents.due),
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h2 className="text-2xl font-semibold text-foreground">
          Subscription Dues: FY {year}–{year + 1}
        </h2>
        <div className="flex items-center gap-3">
          <Link
            href={`/accounting/dues?year=${year}${owingOnly ? "" : "&filter=owing"}`}
            className="text-sm underline text-muted-foreground whitespace-nowrap"
          >
            {owingOnly ? "Show all" : "Owing only"}
          </Link>
          <YearSelector currentYear={year} />
          <PrintButton />
        </div>
      </div>
      <h2 className="hidden print:block text-xl font-semibold mb-4">
        Subscription Dues: FY {year}–{year + 1}
      </h2>

      {!subAccount && (
        <div className="mb-4 p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning">
          ⚠ No income account with code {SUBSCRIPTION_ACCOUNT_CODE} found — paid amounts cannot be
          calculated. Create or restore the &quot;Church Subscription Fees&quot; account.
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {owingOnly
            ? "No families currently owe subscription dues for this year."
            : "No families have a monthly subscription set. Set one on the family edit page."}
        </p>
      ) : (
        <>
        <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <thead>
            <tr className="border-b-2 border-border">
              <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Family</th>
              <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Member No</th>
              <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Monthly</th>
              <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Expected</th>
              <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Paid</th>
              <th className="text-right py-2 font-semibold text-muted-foreground">Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border">
                <td className="py-2 pr-3 font-medium">
                  <Link href={`/families/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{r.memberNo ?? "—"}</td>
                <td className="py-2 pr-3 text-right tabular">{fmt(r.monthly)}</td>
                <td className="py-2 pr-3 text-right tabular">{fmt(r.expected)}</td>
                <td className="py-2 pr-3 text-right tabular text-income">{fmt(r.paid)}</td>
                <td
                  className={`py-2 text-right tabular font-semibold ${r.due > 0 ? "text-expense" : "text-muted-foreground"}`}
                >
                  {fmt(r.due)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-bold">
              <td colSpan={3} className="py-2 pr-3">Total</td>
              <td className="py-2 pr-3 text-right tabular">{fmt(totals.expected)}</td>
              <td className="py-2 pr-3 text-right tabular">{fmt(totals.paid)}</td>
              <td className="py-2 text-right tabular">{fmt(totals.due)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
        {/* Mobile: card per family (avoids sideways table scroll) */}
        <ul className="space-y-2 md:hidden">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    <Link href={`/families/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Member No {r.memberNo ?? "—"}
                  </p>
                </div>
                <span
                  className={`shrink-0 tabular font-semibold whitespace-nowrap ${r.due > 0 ? "text-expense" : "text-muted-foreground"}`}
                >
                  {fmt(r.due)}
                </span>
              </div>
              <div className="mt-2 flex justify-end gap-4 text-xs">
                <span className="text-muted-foreground">Monthly <span className="tabular">{fmt(r.monthly)}</span></span>
                <span className="text-muted-foreground">Expected <span className="tabular">{fmt(r.expected)}</span></span>
                <span className="text-income">Paid <span className="tabular">{fmt(r.paid)}</span></span>
              </div>
            </li>
          ))}
          <li className="rounded-lg border bg-secondary p-3 text-sm">
            <div className="flex items-center justify-between font-bold">
              <span>Total</span>
              <span className="tabular">{fmt(totals.due)}</span>
            </div>
            <div className="mt-1 flex justify-end gap-4 text-xs">
              <span className="text-muted-foreground">Expected <span className="tabular">{fmt(totals.expected)}</span></span>
              <span className="text-muted-foreground">Paid <span className="tabular">{fmt(totals.paid)}</span></span>
            </div>
          </li>
        </ul>
        </>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Expected = completed months this financial year × the family&apos;s monthly subscription
        (pro-rated from their joined date; the current month is not billed until it ends). Paid =
        subscription income recorded against the family this FY.
      </p>
    </div>
  )
}
