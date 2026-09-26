import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewAccounting, canViewPeople } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { Button } from "@/components/ui/button"
import { PrintButton } from "@/components/ui/PrintButton"
import { YearSelector } from "@/components/accounting/YearSelector"
import { getGivingSummary } from "@/lib/givingSummary"
import { currentFYYear } from "@/lib/fiscalYear"
import { fmtAUDAccounting, formatDMY, centsToNumber } from "@/lib/formatting"

type Props = {
  searchParams: Promise<{ year?: string }>
}

export default async function GivingSummaryPage(props: Props) {
  const searchParams = await props.searchParams
  const session = await auth()
  // Read-only accounting roles (ADMIN | PASTOR | AUDITOR) — AUDITOR included so
  // oversight of donor giving is part of their read-only remit.
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "Transaction", undefined, {
    report: "giving-summary",
  })

  const fyNow = currentFYYear()
  const parsedYear = Number.parseInt(searchParams.year ?? String(fyNow), 10)
  const year = parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : fyNow

  // Primary email is member PII — AUDITOR is accounting-only and must not see
  // it decrypted, on-screen or in the export.
  const showEmail = canViewPeople(session?.user?.role)
  const rows = await getGivingSummary(year, showEmail)
  // r.totalCents is already an integer-cents value — sum the integers directly.
  // Passing it through sumCents/toCents would re-scale each by 100.
  const grandTotal = centsToNumber(rows.reduce((sum, r) => sum + r.totalCents, 0))

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h2 className="text-2xl font-semibold text-foreground">
          Giving Summary — FY {year}–{year + 1}
        </h2>
        <div className="flex items-center gap-3">
          <YearSelector currentYear={year} />
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/accounting/reports/giving-summary/export-csv?year=${year}`}>
              Export CSV
            </a>
          </Button>
          <PrintButton />
        </div>
      </div>
      <h2 className="hidden print:block text-xl font-semibold mb-4">
        Giving Summary — FY {year}–{year + 1}
      </h2>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No giving recorded for FY {year}–{year + 1}. Try selecting another year.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-table-wide">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Family</th>
                <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Member No</th>
                {showEmail && (
                  <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Primary Email</th>
                )}
                <th className="text-right py-1 pr-3 font-semibold text-muted-foreground">Total Giving</th>
                <th className="text-right py-1 pr-3 font-semibold text-muted-foreground"># Tx</th>
                <th className="text-right py-1 font-semibold text-muted-foreground">Last Giving</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.familyId} className="border-b border-border">
                  <td className="py-1.5 pr-3 text-sm">
                    <Link href={`/families/${r.familyId}/giving?year=${year}`} className="hover:underline">
                      {r.familyName}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-muted-foreground text-sm">{r.memberNo ?? "—"}</td>
                  {showEmail && (
                    <td className="py-1.5 pr-3 text-sm text-muted-foreground">{r.email || "—"}</td>
                  )}
                  <td className="py-1.5 pr-3 text-right tabular text-sm">{fmtAUDAccounting(centsToNumber(r.totalCents))}</td>
                  <td className="py-1.5 pr-3 text-right tabular text-sm text-muted-foreground">{r.txCount}</td>
                  <td className="py-1.5 text-right tabular text-sm text-muted-foreground">
                    {r.lastGiving ? formatDMY(r.lastGiving) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-4 border-foreground font-bold">
                <td colSpan={showEmail ? 3 : 2} className="pt-3 pr-3">
                  Total ({rows.length} {rows.length === 1 ? "family" : "families"})
                </td>
                <td className="pt-3 pr-3 text-right tabular">{fmtAUDAccounting(grandTotal)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
