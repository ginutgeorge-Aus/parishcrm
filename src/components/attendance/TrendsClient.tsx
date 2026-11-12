"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import type { Point } from "@/lib/attendance"
import { AttendanceChart } from "./AttendanceChart"
import { YearOverYearChart } from "./YearOverYearChart"

export type TrendView = "weekly" | "monthly" | "year"

type Props = {
  view: TrendView
  typeId: number | null
  granularity: "week" | "month"
  serviceTypes: { id: number; name: string }[]
  points?: Point[]
  yoy?: { period: number; thisYear: number | null; lastYear: number | null }[]
  year?: number
}

/**
 * Build a /attendance/trends URL. Tab, service filter and year granularity live
 * in the query string so a view is shareable.
 */
function href(view: TrendView, typeId: number | null, granularity: "week" | "month"): string {
  const p = new URLSearchParams()
  if (view !== "weekly") p.set("view", view)
  if (typeId !== null) p.set("type", String(typeId))
  if (view === "year" && granularity === "week") p.set("g", "week")
  const q = p.toString()
  return q ? `/attendance/trends?${q}` : "/attendance/trends"
}

const TABS: { view: TrendView; label: string }[] = [
  { view: "weekly", label: "Weekly" },
  { view: "monthly", label: "Monthly" },
  { view: "year", label: "Year" },
]

/** Trends view: tab + service filter controls above the matching chart. */
export function TrendsClient({ view, typeId, granularity, serviceTypes, points, yoy, year }: Readonly<Props>) {
  const router = useRouter()
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full border px-4 text-sm sm:min-h-8",
      active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Trend period" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link key={t.view} href={href(t.view, typeId, granularity)} className={chip(view === t.view)} aria-current={view === t.view ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="trend-service" className="text-sm text-muted-foreground">
            Service
          </label>
          <select
            id="trend-service"
            value={typeId ?? ""}
            onChange={(e) => router.push(href(view, e.target.value === "" ? null : Number(e.target.value), granularity))}
            className="h-11 rounded-md border bg-background px-3 text-sm sm:h-8"
          >
            <option value="">All services</option>
            {serviceTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {view === "year" ? (
        <div className="space-y-3">
          <nav aria-label="Compare by" className="flex gap-2">
            {(["month", "week"] as const).map((g) => (
              <Link key={g} href={href("year", typeId, g)} className={chip(granularity === g)} aria-current={granularity === g ? "page" : undefined}>
                By {g}
              </Link>
            ))}
          </nav>
          <YearOverYearChart data={yoy ?? []} year={year ?? new Date().getFullYear()} granularity={granularity} />
        </div>
      ) : (
        <AttendanceChart points={points ?? []} />
      )}
      <p className="text-xs text-muted-foreground">Weeks and months with no recorded headcount are left blank, not shown as zero.</p>
    </div>
  )
}
