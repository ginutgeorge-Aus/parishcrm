import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { escapeCsv } from "@/lib/csvUtils"
import { sydneyTodayYMD } from "@/lib/dates"
import { parseRouteId } from "@/lib/validation"
import { prisma } from "@/lib/prisma"
import { groupCsvCells } from "@/lib/groups"
import { loadMemberExportRows } from "@/lib/groupMembers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Filename-safe slug of a group name ("Youth & Choir" → "youth-choir"). */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "group"
}

/**
 * Member CSV for one group (name, family, role, title, joined, email, mobile).
 * ADMIN only (bulk decrypted email/mobile, like the people export); rate-limited and audited. Every cell goes through
 * `escapeCsv` (formula-injection guard).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const id = parseRouteId((await ctx.params).id)
  if (id === null) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!rateLimit(`export:group:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const group = await prisma.group.findUnique({ where: { id }, select: { name: true } })
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const rows = await loadMemberExportRows(id)
  const csv = groupCsvCells(rows).map((line) => line.map(escapeCsv).join(",")).join("\n")

  await logAudit(actorId(session), "GROUP_MEMBERS_EXPORTED", "Group", id, { rowCount: rows.length }, auditIpFromRequest(req))

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="group-${slug(group.name)}-${sydneyTodayYMD()}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
