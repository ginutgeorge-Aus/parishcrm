import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canBrowseSundaySchool } from "@/lib/roleGuard"
import { canMarkExam } from "@/lib/sundaySchoolAccess"
import { parseRouteId } from "@/lib/validation"
import { renderExamList } from "@/components/sunday-school/examView"

/** Staff exam list. canBrowseSundaySchool to view; canMarkExam (editors, HEADMASTER) to add/archive — VIEWER is read-only. */
export default async function ClassExamsPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canBrowseSundaySchool(session.user.role)) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  const canMark = await canMarkExam(actorId(session), id, session.user.role)
  return renderExamList({ classId: id, canMark, hrefBase: `/sunday-school/${id}/exams`, backHref: `/sunday-school/${id}`, backLabel: "Class" })
}
