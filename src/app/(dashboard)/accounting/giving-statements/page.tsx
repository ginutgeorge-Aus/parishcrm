import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewAccounting, canAccessAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { currentFYYear, fyRangeLabel } from "@/lib/fiscalYear"
import { parseStatementYear } from "@/lib/givingStatement"
import { listGivingStatements, listStatementSendLog } from "@/lib/actions/givingStatement"
import { YearSelector } from "@/components/accounting/YearSelector"
import { GivingStatementsClient } from "@/components/accounting/GivingStatementsClient"
import { Badge } from "@/components/ui/badge"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

type Props = { searchParams: Promise<{ year?: string }> }

/** Annual giving statements: per-family FY totals by fund, PDF preview, bulk email and send log. */
export default async function GivingStatementsPage(props: Readonly<Props>) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const fyNow = currentFYYear()
  // Default to the most recently finished FY once the current one has started: statements are
  // normally sent after year end.
  const year = parseStatementYear(searchParams.year) ?? fyNow - 1

  void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "Transaction", undefined, { report: "giving-statements" })

  const [rows, log] = await Promise.all([listGivingStatements(year), listStatementSendLog(year)])
  // Role is checked above and the feature by the layout, so a remaining error is operational
  // (e.g. the gift scan cap): show it here rather than bouncing to the dashboard.
  if ("error" in rows) return <p role="alert" className="text-sm text-destructive">{rows.error}</p>
  if ("error" in log) return <p role="alert" className="text-sm text-destructive">{log.error}</p>
  const canManage = canAccessAccounting(session?.user?.role)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Giving statements</h2>
          <p className="text-sm text-muted-foreground">
            Every gift per family for the financial year, totalled by fund. Not a tax receipt — see DGR receipts for those.
          </p>
        </div>
        <YearSelector currentYear={year} />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No giving recorded for FY {fyRangeLabel(year, { short: true })}.</p>
      ) : (
        <GivingStatementsClient key={year} year={year} rows={rows} canManage={canManage} />
      )}

      <section className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">Send log</h3>
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">No statements sent for this year yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border bg-card text-sm">
            {log.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="font-medium">{l.familyName}</span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Badge variant={l.status === "SENT" ? "default" : l.status === "SKIPPED" ? "secondary" : "destructive"}>{l.status}</Badge>
                  {l.reason && <span>{l.reason.replaceAll("_", " ")}</span>}
                  <span>{l.sentBy}</span>
                  <span>{l.at.toLocaleString(APP_LOCALE, { timeZone: APP_TIMEZONE })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
