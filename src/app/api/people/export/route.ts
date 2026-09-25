import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { isAdmin } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { Classification, FamilyRole } from "@/lib/generated/prisma/enums"
import { MONTH_ABBR } from "@/lib/formatting"
import { escapeCsv } from "@/lib/csvUtils"

function fmtDate(d: Date | null): string {
  if (!d) return ""
  const dt = new Date(d)
  // membershipDate/baptismDate are UTC-midnight calendar anchors — use the UTC
  // getters so negative-UTC-offset servers don't shift the CSV date back a day
  // (gemini-nightly).
  return `${String(dt.getUTCDate()).padStart(2, "0")}/${MONTH_ABBR[dt.getUTCMonth()]}/${dt.getUTCFullYear()}`
}

export async function GET(req: NextRequest) {
  const session = await auth()
  // ADMIN only — matches single-person export (/api/people/[id]/export). Bulk
  // decrypt+export of all members' PII is a higher-risk op than per-person edit,
  // so PASTOR is excluded.
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!rateLimit(`export:people:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = req.nextUrl
  const q = searchParams.get("q")?.trim() ?? ""
  const classificationFilter = Object.values(Classification).includes(
    searchParams.get("classification") as Classification
  ) ? (searchParams.get("classification") as Classification) : null
  const roleFilter = Object.values(FamilyRole).includes(
    searchParams.get("role") as FamilyRole
  ) ? (searchParams.get("role") as FamilyRole) : null

  // Safety cap: every row decrypts email/mobile/DOB in memory before the
  // first byte is written, so an unbounded findMany grows memory with the
  // congregation. 10k covers the parish many times over; if it ever truncates,
  // a response header flags it so the caller knows the CSV is partial.
  const EXPORT_CAP = 10000
  const people = await prisma.person.findMany({
    where: {
      archivedAt: null,
      ...(q && {
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
        ],
      }),
      ...(classificationFilter && { classification: classificationFilter }),
      ...(roleFilter && { role: roleFilter }),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: EXPORT_CAP,
    select: {
      firstName: true,
      lastName: true,
      role: true,
      classification: true,
      email: true,
      mobile: true,
      dateOfBirth: true,
      membershipDate: true,
      baptismDate: true,
      family: { select: { name: true } },
    },
  })

  const headers = [
    "First Name", "Last Name", "Family", "Role", "Classification",
    "Email", "Mobile", "Date of Birth", "Membership Date", "Baptism Date",
  ]

  const rows = people.map((p) => [
    p.firstName,
    p.lastName,
    p.family?.name ?? "",
    p.role,
    p.classification,
    p.email ? safeDecrypt(p.email) : "",
    p.mobile ? safeDecrypt(p.mobile) : "",
    p.dateOfBirth ? safeDecrypt(p.dateOfBirth) : "",
    fmtDate(p.membershipDate),
    fmtDate(p.baptismDate),
  ])

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n")

  const ip = getClientIp(req)
  await logAudit(
    actorId(session),
    "EXPORT_CSV",
    "Person",
    undefined,
    { rowCount: people.length },
    ip
  )

  const responseHeaders: Record<string, string> = {
    "Content-Type": "text/csv",
    "Content-Disposition": 'attachment; filename="people-export.csv"',
    "Cache-Control": "no-store",
  }
  if (people.length === EXPORT_CAP) responseHeaders["X-Export-Truncated"] = "true"

  return new NextResponse(csv, { headers: responseHeaders })
}
