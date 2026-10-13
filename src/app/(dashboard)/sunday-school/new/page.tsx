import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canEdit } from "@/lib/roleGuard"
import { parseSchoolYear } from "@/lib/sundaySchool"
import { createClass } from "@/lib/actions/sundaySchool"
import { lockedYears } from "@/lib/sundaySchoolYearLock"
import { ClassForm } from "@/components/sunday-school/ClassForm"

/** New Sunday School class for `?year=` (default: current school year). canEdit only. */
export default async function NewClassPage(props: Readonly<{ searchParams: Promise<{ year?: string }> }>) {
  const session = await auth()
  if (!canEdit(session?.user?.role)) redirect("/sunday-school")
  const year = parseSchoolYear((await props.searchParams).year)
  // Rolled-over years are read-only; createClass refuses them too.
  if ((await lockedYears([year])).has(year)) redirect(`/sunday-school?year=${year}`)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/sunday-school?year=${year}`} className="hover:underline">Sunday School</Link>
          {" / New class"}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">New class</h2>
      </div>
      <ClassForm action={createClass.bind(null, year)} year={year} />
    </div>
  )
}
