import Link from "next/link"
import { requireSettingsTab } from "@/lib/settingsAccess"
import { SettingsCard } from "@/components/settings/ui/SettingsCard"
import { getUsageSummary } from "@/lib/usage"
import { getTopRoutes } from "@/lib/routeViews"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Props = { searchParams: Promise<{ days?: string }> }

/** Settings → App Usage: audit-log-derived adoption, trend, top pages and dormant features. */
export default async function UsagePage(props: Readonly<Props>) {
  await requireSettingsTab("/settings/usage")

  const { days: daysParam } = await props.searchParams
  const days = daysParam === "90" ? 90 : 30
  const [s, topRoutes] = await Promise.all([getUsageSummary(days), getTopRoutes(days)])
  const maxTrend = Math.max(1, ...s.weeklyTrend.map((w) => w.count))

  return (
    <SettingsCard
      title="App Usage"
      description={`${s.activeUsers} active user${s.activeUsers === 1 ? "" : "s"} in the last ${days} days. Counts are mutations recorded in the audit log — no personal data.`}
    >
      <div className="space-y-8 py-5">
        <div className="flex items-center justify-end">
          <div className="flex gap-2 text-sm">
            {([30, 90] as const).map((d) => (
              <Link
                key={d}
                href={`/settings/usage?days=${d}`}
                aria-current={days === d ? "page" : undefined}
                className={`inline-flex items-center justify-center min-h-11 px-3 ${days === d ? "font-semibold underline" : "text-muted-foreground"}`}
              >
                {d} days
              </Link>
            ))}
          </div>
        </div>

        <section>
          <h3 className="mb-2 text-lg font-medium">Feature adoption</h3>
          <Table aria-label="Feature adoption">
            <TableHeader>
              <TableRow>
                <TableHead>Feature area</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.adoption.map((a) => (
                <TableRow key={a.resourceType}>
                  <TableCell>{a.resourceType}</TableCell>
                  <TableCell className="text-right tabular">{a.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section>
          <h3 className="mb-2 text-lg font-medium">Activity trend (12 weeks)</h3>
          <div className="flex items-end gap-1 h-24">
            {s.weeklyTrend.map((w) => (
              <div key={w.label} className="flex-1 bg-primary/70 rounded-t" role="img" aria-label={`${w.label}: ${w.count} actions`} style={{ height: `${(w.count / maxTrend) * 100}%` }} title={`${w.label}: ${w.count}`} />
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-lg font-medium">Most-viewed pages ({days} days)</h3>
          {topRoutes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No page views recorded yet.</p>
          ) : (
            <ul className="text-sm">
              {topRoutes.map((r) => (
                <li key={r.route} className="flex justify-between border-b py-1">
                  <span className="font-mono">{r.route}</span>
                  <span className="tabular">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-lg font-medium">Dormant features</h3>
          {s.dormant.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every tracked feature saw activity.</p>
          ) : (
            <ul className="list-disc pl-5 text-sm">
              {s.dormant.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SettingsCard>
  )
}
