import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canManageSundaySchool } from "@/lib/roleGuard"
import { parseSchoolYear } from "@/lib/sundaySchool"
import { lockedYears } from "@/lib/sundaySchoolYearLock"
import { EnrolImportClient } from "@/components/sunday-school/EnrolImportClient"

/** Enrolment CSV import for `?year=` (default: current school year). canManageSundaySchool only. */
export default async function ImportEnrolmentsPage(props: Readonly<{ searchParams: Promise<{ year?: string }> }>) {
  const session = await auth()
  if (!canManageSundaySchool(session?.user?.role)) redirect("/sunday-school")
  const year = parseSchoolYear((await props.searchParams).year)
  // Rolled-over years are read-only; the import actions refuse them too.
  if ((await lockedYears([year])).has(year)) redirect(`/sunday-school?year=${year}`)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/sunday-school?year=${year}`} className="hover:underline">Sunday School</Link>
          {" / Import enrolments"}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">Import enrolments for {year}</h2>
      </div>
      <EnrolImportClient year={year} />
    </div>
  )
}
