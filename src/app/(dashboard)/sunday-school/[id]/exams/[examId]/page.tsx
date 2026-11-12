import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canBrowseSundaySchool } from "@/lib/roleGuard"
import { canMarkExam } from "@/lib/sundaySchoolAccess"
import { parseRouteId } from "@/lib/validation"
import { renderExamMarks } from "@/components/sunday-school/examView"

/** Staff marks page. canBrowseSundaySchool to view; canMarkExam to enter marks — VIEWER is read-only. */
export default async function ClassExamMarksPage(props: Readonly<{ params: Promise<{ id: string; examId: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canBrowseSundaySchool(session.user.role)) redirect("/")
  const p = await props.params
  const id = parseRouteId(p.id)
  const examId = parseRouteId(p.examId)
  if (id === null || examId === null) notFound()
  const canMark = await canMarkExam(actorId(session), id, session.user.role)
  return renderExamMarks({ classId: id, examId, canMark, backHref: `/sunday-school/${id}/exams`, backLabel: "Exams" })
}
