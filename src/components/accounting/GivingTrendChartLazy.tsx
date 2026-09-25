"use client"

import dynamic from "next/dynamic"

type DataPoint = { month: string; amount: number }

const GivingTrendChartDynamic = dynamic(
  () => import("@/components/accounting/GivingTrendChart").then((m) => m.GivingTrendChart),
  {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse rounded bg-muted" />,
  }
)

export function GivingTrendChartLazy({ data }: { data: DataPoint[] }) {
  return <GivingTrendChartDynamic data={data} />
}
