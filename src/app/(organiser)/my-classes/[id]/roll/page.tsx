import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canMarkRoll } from "@/lib/sundaySchoolAccess"
import { parseRouteId } from "@/lib/validation"
import { renderRollView } from "@/components/sunday-school/rollView"

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string | string[] }> }

/** Volunteer roll page: only classes this login may mark (canMarkRoll); others 404. */
export default async function OrganiserRollPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  // IDOR gate: an unassigned class is indistinguishable from a missing one.
  if (!(await canMarkRoll(actorId(session), id, session.user.role))) notFound()
  const sp = await props.searchParams
  const rawDate = typeof sp.date === "string" ? sp.date : undefined

  return renderRollView({
    classId: id,
    rawDate,
    canMark: true,
    hrefBase: `/my-classes/${id}/roll`,
    backHref: "/my-classes",
    backLabel: "My classes",
  })
}
