import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canMarkExam } from "@/lib/sundaySchoolAccess"
import { parseRouteId } from "@/lib/validation"
import { renderExamList } from "@/components/sunday-school/examView"

/** Teacher exam list: only classes this login may mark (canMarkExam); others 404. */
export default async function OrganiserExamsPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  // IDOR gate: an unassigned class is indistinguishable from a missing one.
  if (!(await canMarkExam(actorId(session), id, session.user.role))) notFound()
  return renderExamList({ classId: id, canMark: true, hrefBase: `/my-classes/${id}/exams`, backHref: "/my-classes", backLabel: "My classes" })
}
