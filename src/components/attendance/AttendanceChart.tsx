"use client"

import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import type { Point } from "@/lib/attendance"

const chartConfig = {
  adults: { label: "Adults", color: "hsl(var(--primary))" },
  children: { label: "Children", color: "hsl(var(--income))" },
}

/**
 * Stacked adults + children bars, one per week or month. A period with no
 * recorded headcount has `null` values and so draws no bar (a gap); a recorded
 * 0 draws a zero-height bar. Bars (not areas) so a lone recorded period between
 * gaps stays visible.
 */
export function AttendanceChart({ points }: Readonly<{ points: Point[] }>) {
  const recorded = points.filter((p) => p.adults !== null || p.children !== null)
  if (recorded.length === 0) {
    return <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No headcounts recorded for this period.</p>
  }
  const total = recorded.reduce((s, p) => s + (p.adults ?? 0) + (p.children ?? 0), 0)
  const label = `Attendance from ${points[0].label} to ${points.at(-1)?.label}, total ${total} across ${recorded.length} recorded period${recorded.length === 1 ? "" : "s"}`

  return (
    <ChartContainer config={chartConfig} className="h-72 w-full xl:h-96" role="img" aria-label={label}>
      <BarChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: "0.6875rem" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: "0.6875rem" }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Bar dataKey="adults" name="Adults" stackId="headcount" fill="var(--color-adults)" />
        <Bar dataKey="children" name="Children" stackId="headcount" fill="var(--color-children)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}
