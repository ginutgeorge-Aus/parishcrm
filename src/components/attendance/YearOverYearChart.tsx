"use client"

import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts"
import { ChartContainer } from "@/components/ui/chart"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const chartConfig = {
  thisYear: { label: "This year", color: "hsl(var(--primary))" },
  lastYear: { label: "Last year", color: "hsl(var(--muted-foreground))" },
}

/**
 * This year vs last year, total (adults + children) per ISO week or month. A
 * period with no recorded headcount is `null`: the line breaks there rather
 * than dropping to 0 (`connectNulls={false}`), and a recorded 0 plots as 0.
 */
export function YearOverYearChart({
  data,
  year,
  granularity,
}: Readonly<{
  data: { period: number; thisYear: number | null; lastYear: number | null }[]
  year: number
  granularity: "week" | "month"
}>) {
  if (data.every((d) => d.thisYear === null && d.lastYear === null)) {
    return <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No headcounts recorded for {year} or {year - 1}.</p>
  }
  const rows = data.map((d) => ({ ...d, label: granularity === "month" ? MONTHS[d.period - 1] : `W${d.period}` }))
  const sum = (k: "thisYear" | "lastYear") => data.reduce((s, d) => s + (d[k] ?? 0), 0)
  const label = `Attendance ${year} compared with ${year - 1} by ${granularity}: ${sum("thisYear")} recorded in ${year}, ${sum("lastYear")} in ${year - 1}`

  return (
    <ChartContainer config={chartConfig} className="h-72 w-full xl:h-96" role="img" aria-label={label}>
      <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: "0.6875rem" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: "0.6875rem" }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Line dataKey="thisYear" name={String(year)} stroke="var(--color-thisYear)" strokeWidth={2} connectNulls={false} dot />
        <Line dataKey="lastYear" name={String(year - 1)} stroke="var(--color-lastYear)" strokeWidth={2} strokeDasharray="4 3" connectNulls={false} dot />
      </LineChart>
    </ChartContainer>
  )
}
