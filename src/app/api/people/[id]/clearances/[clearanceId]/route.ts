import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { canManageClearances } from "@/lib/roleGuard"
import { decrypt } from "@/lib/crypto"
import { rateLimit } from "@/lib/rateLimit"
import { parseRouteId } from "@/lib/validation"

const notFound = () => new NextResponse("Not found", { status: 404 })
const CLEARANCE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

// Only inert types render inline; anything else is forced to download as
// octet-stream so a spoofed stored type can't execute as stored XSS.
const INLINE_SAFE = new Set(["application/pdf", "image/png", "image/jpeg"])

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
  if (personId === null || !CLEARANCE_ID_RE.test(clearanceId)) return notFound()

  const row = await prisma.personClearance.findUnique({
    where: { id: clearanceId },
    select: { personId: true, type: true, document: true, documentType: true, documentName: true },
  })
  // Scope to the addressed person: a real clearance on someone else 404s like a missing one.
  if (row?.personId !== personId || !row.document || !row.documentType) return notFound()

  // Stored blob is base64 ciphertext (UTF-8 bytes); reverse to the raw file.
  const stored = (Buffer.isBuffer(row.document) ? row.document : Buffer.from(row.document as Uint8Array)).toString("utf8")
  const body = Buffer.from(decrypt(stored), "base64")
  const filename = row.documentName ? decrypt(row.documentName) : "clearance"
  const encoded = encodeURIComponent(filename)
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  const inline = INLINE_SAFE.has(row.documentType)

  await logAudit(
    actorId(session),
    "CLEARANCE_VIEWED",
    "Person",
    personId,
    { type: row.type, clearanceId },
    getClientIp(req),
  )

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": inline ? row.documentType : "application/octet-stream",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
    },
  })
}
