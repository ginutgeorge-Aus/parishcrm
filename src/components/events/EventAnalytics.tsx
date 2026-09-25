"use client"

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import { fmtAUD } from "@/lib/formatting"

type Props = {
  fillRates: { name: string; sold: number; capacity: number | null; pct: number | null }[]
  revenueByType: { name: string; revenue: number }[]
  regsOverTime: { date: string; cumulative: number }[]
}

const chartConfig = { cumulative: { label: "Registrations", color: "hsl(var(--income))" } }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</p>
      {children}
    </div>
  )
}

export function EventAnalytics({ fillRates, revenueByType, regsOverTime }: Props) {
  const hasFill = fillRates.length > 0
  const hasRevenue = revenueByType.some(r => r.revenue > 0)
  const hasTime = regsOverTime.length > 0
  if (!hasFill && !hasRevenue && !hasTime) return null

  const maxRevenue = Math.max(1, ...revenueByType.map(r => r.revenue))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      {hasFill && (
        <Card title="Fill Rate">
          <div className="space-y-3">
            {fillRates.map(f => (
              <div key={f.name}>
                <div className="flex justify-between text-xs text-foreground mb-1">
                  <span>{f.name}</span>
                  <span className="text-muted-foreground">
                    {f.capacity == null || f.capacity === 0
                      ? `${f.sold} sold · No cap`
                      : `${f.sold}/${f.capacity} · ${f.pct}%`}
                  </span>
                </div>
                {f.capacity != null && f.capacity > 0 && (
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-income"
                      style={{ width: `${Math.min(100, f.pct ?? 0)}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {hasRevenue && (
        <Card title="Revenue by Ticket">
          <div className="space-y-3">
            {revenueByType.map(r => (
              <div key={r.name}>
                <div className="flex justify-between text-xs text-foreground mb-1">
                  <span>{r.name}</span>
                  <span className="tabular text-muted-foreground">{fmtAUD(r.revenue)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-income"
                    style={{ width: `${Math.round((r.revenue / maxRevenue) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {hasTime && (
        <Card title="Registrations Over Time">
          <ChartContainer config={chartConfig} className="h-48 w-full">
            <AreaChart data={regsOverTime} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
              <Tooltip formatter={(v) => [String(v), "Registrations"]} />
              <Area type="monotone" dataKey="cumulative" stroke="var(--color-cumulative)" fill="var(--color-cumulative)" fillOpacity={0.15} />
            </AreaChart>
          </ChartContainer>
        </Card>
      )}
    </div>
  )
}
