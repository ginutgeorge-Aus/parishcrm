"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import { fmtAUD } from "@/lib/formatting"
import { APP_LOCALE, APP_CURRENCY } from "@/lib/appConfig"

const axisTick = new Intl.NumberFormat(APP_LOCALE, { style: "currency", currency: APP_CURRENCY, notation: "compact", maximumFractionDigits: 0 })

type DataPoint = { month: string; amount: number }

const chartConfig = {
  amount: { label: "Giving", color: "hsl(var(--income))" },
}

export function GivingTrendChart({ data }: { data: DataPoint[] }) {
  if (data.every((d) => d.amount === 0)) return null

  // No adjacent text/table alternative today, so the bar chart needs its own
  // accessible name — a screen-reader user otherwise gets nothing.
  // Built from the data itself rather than assumed as "last 12 months": the
  // caller may pass a fixed financial year, not a rolling window.
  const total = data.reduce((s, d) => s + d.amount, 0)
  const chartLabel =
    data.length > 0
      ? `Monthly giving trend from ${data[0].month} to ${data[data.length - 1].month}, totaling ${fmtAUD(total)}`
      : "Monthly giving trend"

  return (
    <ChartContainer config={chartConfig} className="h-48 w-full" role="img" aria-label={chartLabel}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => axisTick.format(v)}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip
          formatter={(value) => [
            fmtAUD(Number(value)),
            "Giving",
          ]}
        />
        <Bar dataKey="amount" fill="var(--color-amount)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}
