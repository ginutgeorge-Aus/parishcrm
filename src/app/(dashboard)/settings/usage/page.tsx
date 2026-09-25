import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
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

export default async function UsagePage(props: Props) {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")

  const { days: daysParam } = await props.searchParams
  const days = daysParam === "90" ? 90 : 30
  const [s, topRoutes] = await Promise.all([getUsageSummary(days), getTopRoutes(days)])
  const maxTrend = Math.max(1, ...s.weeklyTrend.map((w) => w.count))

  return (
    <div className="space-y-8 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[clamp(1.5rem,4vw,2.25rem)] font-semibold">Usage</h1>
        <div className="flex gap-2 text-sm">
          <a href="/settings/usage?days=30" className={`inline-flex items-center justify-center min-h-11 px-3 ${days === 30 ? "font-semibold underline" : "text-muted-foreground"}`}>30 days</a>
          <a href="/settings/usage?days=90" className={`inline-flex items-center justify-center min-h-11 px-3 ${days === 90 ? "font-semibold underline" : "text-muted-foreground"}`}>90 days</a>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {s.activeUsers} active user{s.activeUsers === 1 ? "" : "s"} in the last {days} days.
        Counts are mutations recorded in the audit log — no personal data.
      </p>

      <section>
        <h2 className="mb-2 text-lg font-medium">Feature adoption</h2>
        <Table>
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
        <h2 className="mb-2 text-lg font-medium">Activity trend (12 weeks)</h2>
        <div className="flex items-end gap-1 h-24">
          {s.weeklyTrend.map((w) => (
            <div key={w.label} className="flex-1 bg-primary/70 rounded-t" style={{ height: `${(w.count / maxTrend) * 100}%` }} title={`${w.label}: ${w.count}`} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Most-viewed pages ({days} days)</h2>
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
        <h2 className="mb-2 text-lg font-medium">Dormant features</h2>
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
  )
}
