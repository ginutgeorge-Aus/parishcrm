import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatYMD, type latestWithDelta } from "@/lib/attendance"

/**
 * Dashboard tile: the latest recorded service headcount and its change versus
 * the same service one week earlier (hidden when that week has no headcount).
 * Empty state links editors to the entry page.
 */
export function AttendanceTile({
  latest,
  serviceName,
  canEnter,
}: Readonly<{
  latest: ReturnType<typeof latestWithDelta>
  serviceName?: string | null
  canEnter: boolean
}>) {
  if (!latest) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h3" className="text-base">Attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">No headcounts yet</p>
          {canEnter && (
            <Link href="/attendance" className="inline-flex min-h-11 items-center text-sm text-primary hover:underline sm:min-h-0">
              Enter a headcount
            </Link>
          )}
        </CardContent>
      </Card>
    )
  }

  const total = latest.adults + latest.children
  const delta = latest.previousTotal === null ? null : total - latest.previousTotal
  const deltaText = delta === null ? null : delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : null

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3" className="text-base">Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm">
          {serviceName && <span className="font-medium">{serviceName}</span>}
          {serviceName && " · "}
          <span className="text-muted-foreground">{formatYMD(latest.date)}</span>
        </p>
        <p className="text-3xl font-bold tabular sm:text-4xl" data-testid="tile-total">{total}</p>
        <p className="text-sm text-muted-foreground">
          {latest.adults} adults · {latest.children} children
        </p>
        {delta !== null && (
          <p className="text-xs" data-testid="tile-delta">
            <span className="tabular font-medium">{deltaText ?? "No change"}</span>{" "}
            <span className="text-muted-foreground">vs last week</span>
          </p>
        )}
        <Link href="/attendance/trends" className="inline-flex min-h-11 items-center text-xs text-primary hover:underline sm:min-h-0">
          Attendance trends
        </Link>
      </CardContent>
    </Card>
  )
}
