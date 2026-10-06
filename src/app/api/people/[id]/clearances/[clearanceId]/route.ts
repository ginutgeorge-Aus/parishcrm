import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { canManageClearances } from "@/lib/roleGuard"
import { encryptedDocumentResponse } from "@/lib/encryptedDocument"
import { rateLimit } from "@/lib/rateLimit"
import { CUID_ID_RE, parseRouteId } from "@/lib/validation"

const notFound = () => new NextResponse("Not found", { status: 404 })

/**
 * Serve a person's clearance document. Gated by canManageClearances
 * (ADMIN/PASTOR/OFFICE_ADMIN); every other caller — including VIEWER, who may
 * see the status badge but never the document — gets the same 404 as a missing
 * row, so the route can't be probed for existence. The clearance must belong to
 * the addressed person. Rate-limited (each hit decrypts a blob) and audited
 * (CLEARANCE_VIEWED, with client IP).
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string; clearanceId: string }> },
) {
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return notFound()

  if (!rateLimit(`clearance:${actorId(session)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { id, clearanceId } = await props.params
  const personId = parseRouteId(id)
  if (personId === null || !CUID_ID_RE.test(clearanceId)) return notFound()

  const row = await prisma.personClearance.findUnique({
    where: { id: clearanceId },
    select: { personId: true, type: true, document: true, documentType: true, documentName: true },
  })
  // Scope to the addressed person: a real clearance on someone else 404s like a missing one.
  if (row?.personId !== personId || !row.document || !row.documentType) return notFound()

  // Decrypt before auditing so a failed decrypt never records a view.
  const response = encryptedDocumentResponse({
    blob: row.document,
    encryptedName: row.documentName,
    contentType: row.documentType,
    fallbackName: "clearance",
  })

  await logAudit(
    actorId(session),
    "CLEARANCE_VIEWED",
    "Person",
    personId,
    { type: row.type, clearanceId },
    getClientIp(req),
  )

  return response
}
