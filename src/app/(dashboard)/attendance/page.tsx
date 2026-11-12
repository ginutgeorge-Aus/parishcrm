import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { HeadcountForm } from "@/components/attendance/HeadcountForm"
import { getActiveServiceTypes, getRecentHeadcounts } from "@/lib/attendanceQueries"
import { sydneyTodayYMD } from "@/lib/dates"
import { canEditAttendance, canViewAttendance } from "@/lib/roleGuard"

/** How many recent headcounts the entry page loads (edit list + pre-fill lookup). */
const RECENT_LIMIT = 100

/**
 * Service headcount entry (adults / children per service date). Editors only:
 * a VIEWER is sent to the trends page, any other role to the dashboard.
 */
export default async function AttendancePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const role = session.user.role
  if (!canEditAttendance(role)) redirect(canViewAttendance(role) ? "/attendance/trends" : "/")

  const [serviceTypes, rows] = await Promise.all([getActiveServiceTypes(), getRecentHeadcounts(RECENT_LIMIT)])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">Attendance</h2>
        <Link href="/attendance/trends" className="text-sm underline">
          View trends
        </Link>
      </div>
      <HeadcountForm serviceTypes={serviceTypes} rows={rows} today={sydneyTodayYMD()} />
    </div>
  )
}
