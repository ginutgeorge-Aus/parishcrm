import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canMarkExam } from "@/lib/sundaySchoolAccess"
import { parseRouteId } from "@/lib/validation"
import { renderExamMarks } from "@/components/sunday-school/examView"

/** Teacher marks page: class must be assigned (canMarkExam) and the exam must belong to it; otherwise 404. */
export default async function OrganiserExamMarksPage(props: Readonly<{ params: Promise<{ id: string; examId: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const p = await props.params
  const id = parseRouteId(p.id)
  const examId = parseRouteId(p.examId)
  if (id === null || examId === null) notFound()
  if (!(await canMarkExam(actorId(session), id, session.user.role))) notFound()
  return renderExamMarks({ classId: id, examId, canMark: true, backHref: `/my-classes/${id}/exams`, backLabel: "Exams" })
}
