import { auth } from "@/auth"
import { canManageSundaySchool } from "@/lib/roleGuard"
import { featureNotFound } from "@/lib/featureFlags"
import { prisma } from "@/lib/prisma"
import { parseRouteId } from "@/lib/validation"
import { getChurchSettings } from "@/lib/churchSettings"
import { signBadge } from "@/lib/sundaySchoolBadge"
import { renderSundaySchoolBadgesPdf } from "@/lib/pdf/SundaySchoolBadgesPdf"

/** GET /api/sunday-school/[id]/badges — printable QR badge sheet for the class's enrolled children. Managers only. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return new Response("Unauthorized", { status: 401 })
  if (!canManageSundaySchool(session.user.role)) return new Response("Forbidden", { status: 403 })
  const off = await featureNotFound("sundaySchool")
  if (off) return off
  const id = parseRouteId((await ctx.params).id)
  if (id === null) return new Response("Not found", { status: 404 })

  const cls = await prisma.sundaySchoolClass.findFirst({
    where: { id, archivedAt: null },
    select: {
      name: true, year: true,
      enrolments: { where: { person: { archivedAt: null } }, select: { person: { select: { id: true, firstName: true, lastName: true } } } },
    },
  })
  if (!cls) return new Response("Not found", { status: 404 })

  const students = cls.enrolments
    .map(({ person }) => person)
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
    .map((p) => ({ name: `${p.firstName} ${p.lastName}`.trim(), qr: signBadge(p.id) }))
  const { name: churchName } = await getChurchSettings()
  const pdf = await renderSundaySchoolBadgesPdf({ className: cls.name, year: cls.year, churchName, students })
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=badges-class-${id}.pdf`,
      "Cache-Control": "no-store",
    },
  })
}
