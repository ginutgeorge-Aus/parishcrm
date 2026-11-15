import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { featureNotFound } from "@/lib/featureFlags"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rateLimit"
import { canBrowseSundaySchool } from "@/lib/roleGuard"
import { buildRosterCsv, rosterFilename } from "@/lib/sundaySchoolCsv"
import { parseRouteId } from "@/lib/validation"

/**
 * GET /api/sunday-school/[id]/roster — class roster CSV (student, family, class,
 * level, location, year). Same gate as the class page (canBrowseSundaySchool);
 * the same live children and fields the page shows, nothing more.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canBrowseSundaySchool(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const off = await featureNotFound("sundaySchool")
  if (off) return off
  const id = parseRouteId((await ctx.params).id)
  if (id === null) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!rateLimit(`export:ss-roster:${actorId(session)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const cls = await prisma.sundaySchoolClass.findUnique({
    where: { id },
    select: {
      name: true, level: true, location: true, year: true,
      enrolments: {
        where: { person: { archivedAt: null } },
        orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
        select: { person: { select: { firstName: true, lastName: true, family: { select: { name: true } } } } },
      },
    },
  })
  if (!cls) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const csv = buildRosterCsv(cls, cls.enrolments.map(({ person: p }) => ({ firstName: p.firstName, lastName: p.lastName, familyName: p.family.name })))
  await logAudit(actorId(session), "SS_ROSTER_EXPORTED", "SundaySchoolClass", id, { count: cls.enrolments.length }, auditIpFromRequest(req))
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${rosterFilename(cls)}"`,
      "Cache-Control": "no-store",
    },
  })
}
