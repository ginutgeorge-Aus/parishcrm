import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { TrendsClient, type TrendView } from "@/components/attendance/TrendsClient"
import { addDays, addMonths, buildMonthly, buildWeekly, buildYearOverYear, weekStartYMD } from "@/lib/attendance"
import { getAllServiceTypes, getHeadcountRows } from "@/lib/attendanceQueries"
import { sydneyTodayYMD } from "@/lib/dates"
import { canEditAttendance, canViewAttendance } from "@/lib/roleGuard"

type Props = { searchParams: Promise<{ view?: string; type?: string; g?: string }> }

const WEEKS = 26
const MONTHS = 12

/**
 * Attendance trends: weekly (last 26 weeks), monthly (last 12 months) and
 * year-over-year. Tab, service filter and granularity come from the URL.
 * Any attendance viewer; AUDITOR and EVENT_ORGANISER go to the dashboard.
 */
export default async function AttendanceTrendsPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const role = session.user.role
  if (!canViewAttendance(role)) redirect("/")

  const sp = await props.searchParams
  const view: TrendView = sp.view === "monthly" || sp.view === "year" ? sp.view : "weekly"
  const granularity = sp.g === "week" ? "week" : "month"
  const serviceTypes = await getAllServiceTypes()
  const wanted = Number(sp.type)
  const typeId = serviceTypes.some((t) => t.id === wanted) ? wanted : null
  const filter = typeId ?? undefined

  const today = sydneyTodayYMD()
  const year = Number(today.slice(0, 4))

  let points
  let yoy
  if (view === "weekly") {
    const from = addDays(weekStartYMD(today), -7 * (WEEKS - 1))
    points = buildWeekly(await getHeadcountRows(from, today), from, today, filter)
  } else if (view === "monthly") {
    const fromMonth = addMonths(today.slice(0, 7), -(MONTHS - 1))
    points = buildMonthly(await getHeadcountRows(`${fromMonth}-01`, today), fromMonth, today.slice(0, 7), filter)
  } else {
    // ISO week 1 of last year can start in late December two years back; month
    // buckets only need last year from 1 January.
    const yoyFrom = granularity === "week" ? `${year - 2}-12-25` : `${year - 1}-01-01`
    yoy = buildYearOverYear(await getHeadcountRows(yoyFrom, today), year, granularity, filter)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">Attendance trends</h2>
        {canEditAttendance(role) && (
          <Link href="/attendance" className="text-sm underline">
            Enter headcount
          </Link>
        )}
      </div>
      <TrendsClient view={view} typeId={typeId} granularity={granularity} serviceTypes={serviceTypes} points={points} yoy={yoy} year={year} />
    </div>
  )
}
