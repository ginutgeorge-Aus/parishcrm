import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewPeople } from "@/lib/roleGuard"
import { canMarkRoll } from "@/lib/sundaySchoolAccess"
import { parseRouteId } from "@/lib/validation"
import { renderRollView } from "@/components/sunday-school/rollView"

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string | string[] }> }

/** Staff roll page. canViewPeople to view; canMarkRoll (editors) to mark — VIEWER is read-only. */
export default async function ClassRollPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canViewPeople(session.user.role)) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  const sp = await props.searchParams
  // A repeated ?date= arrives as string[] — ignore it (falls back to today).
  const rawDate = typeof sp.date === "string" ? sp.date : undefined
  const canMark = await canMarkRoll(actorId(session), id, session.user.role)

  return renderRollView({
    classId: id,
    rawDate,
    canMark: canMark,
    hrefBase: `/sunday-school/${id}/roll`,
    backHref: `/sunday-school/${id}`,
    backLabel: "Class",
  })
}
