import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { canManageClearances } from "@/lib/roleGuard"
import { sydneyToday } from "@/lib/dates"
import { loadComplianceRows, loadWwccVerifyBatch, filterRows, capRows } from "@/lib/clearanceCompliance"
import { getWwccVerifyUrl } from "@/lib/clearanceSettings"
import { COMPLIANCE_FILTERS, FILTER_LABELS, parseComplianceFilter } from "@/lib/clearanceComplianceView"
import { ClearanceComplianceTable } from "@/components/people/ClearanceComplianceTable"
import { WwccBatchVerify } from "@/components/people/WwccBatchVerify"
import { Button } from "@/components/ui/button"

/**
 * Clearance compliance (WWCC + Safe Ministry) for people with a ministry role.
 * Default view: status table with filter chips and CSV export. `?view=batch`:
 * the OCG-portal verification helper. ADMIN, PASTOR and OFFICE_ADMIN only
 * (`canManageClearances`); the server action and CSV route re-check the role.
 */
export default async function ClearancesPage(
  props: Readonly<{ searchParams: Promise<{ status?: string; view?: string }> }>
) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canManageClearances(session.user.role)) redirect("/")

  const { status, view } = await props.searchParams
  const today = sydneyToday()

  if (view === "batch") {
    const [{ rows, truncated }, verifyUrl] = await Promise.all([loadWwccVerifyBatch(today), getWwccVerifyUrl()])
    // Decrypted DOBs and WWC numbers are shown in bulk here, so leave a trace.
    await logAudit(actorId(session), "CLEARANCE_BATCH_VIEWED", "Person", undefined, { rowCount: rows.length })
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold text-foreground">Verify WWCC batch</h2>
          <Button variant="outline" size="sm" asChild>
            <Link href="/people/clearances">Back to compliance</Link>
          </Button>
        </div>
        {truncated && (
          <p className="text-sm text-warning bg-warning/10 border border-warning/40 rounded px-3 py-2">
            Too many WWCCs to list in full — showing the first {rows.length}. Verify these, then reload for the rest.
          </p>
        )}
        <WwccBatchVerify rows={rows} verifyUrl={verifyUrl} />
      </div>
    )
  }

  const filter = parseComplianceFilter(status)
  const { rows: all } = await loadComplianceRows(today)
  const matched = filterRows(all, filter)
  const { rows, truncated } = capRows(matched)
  const exportHref = filter ? `/api/clearances/export?status=${filter}` : "/api/clearances/export"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">Clearance compliance</h2>
        <div className="flex gap-2 print:hidden">
          <Button size="sm" asChild>
            <Link href="/people/clearances?view=batch">Verify WWCC batch</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={exportHref} download>Export CSV</a>
          </Button>
        </div>
      </div>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2 print:hidden">
        <Button size="sm" variant={filter ? "outline" : "default"} asChild>
          <Link href="/people/clearances">All</Link>
        </Button>
        {COMPLIANCE_FILTERS.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} asChild>
            <Link href={`/people/clearances?status=${f}`}>{FILTER_LABELS[f]}</Link>
          </Button>
        ))}
      </nav>

      <p className="text-sm text-muted-foreground">
        {matched.length} of {all.length} people with a ministry role or clearance on file
      </p>
      {truncated && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/40 rounded px-3 py-2">
          Too many people to list in full — showing the first {rows.length}.
        </p>
      )}

      <ClearanceComplianceTable rows={rows} filtered={filter !== null} />
    </div>
  )
}
