import { NextRequest, NextResponse } from "next/server"
import type { Session } from "next-auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { generateCsv } from "@/lib/eventExport"
import { canEdit } from "@/lib/roleGuard"
import { isEventManager } from "@/lib/eventManager"
import { safeDecrypt } from "@/lib/crypto"
import { toAnswerMap } from "@/lib/eventAnswers"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"

/** How the export route addresses the event: by public slug, or by integer id (slugless staff-only events). */
export type EventKey = { slug: string } | { id: number }

/**
 * Registrations CSV for one event: editors, or an assigned organiser. Shared by the
 * slug-keyed and id-keyed routes, which each authenticate, role-check and apply the
 * Events feature gate (`featureNotFound`) BEFORE calling this. Rate-limited per user.
 * @param req the incoming request (audit IP)
 * @param session the already-authenticated session (role already checked by the route)
 * @param key resolved event key; null means the route param was invalid (400)
 */
export async function exportEventCsv(req: NextRequest, session: Session & { user: NonNullable<Session["user"]> }, key: EventKey | null): Promise<Response> {
  const isEditor = canEdit(session.user.role)

  // The slug route and the id route share this handler. Next.js forbids sibling
  // [id]/[slug] segments, so the id key lives under a separate path.
  if (!key) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 })
  }
  if (!rateLimit(`export:event:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  const where = key
  // For a non-editor organiser, check per-event ownership on a cheap lookup
  // before running the heavy registrations+attendees join — otherwise
  // an organiser can force that full query against events they don't manage.
  const eventStub = await prisma.event.findUnique({ where, select: { id: true } })
  if (!eventStub) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isEditor && !(await isEventManager(Number.parseInt(session.user.id, 10), eventStub.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Draft events are exportable by editors: this route already requires a
  // canEdit session and resolves by slug, so the old isPublished 404 blocked
  // no real enumeration — it only 404'd admins managing their own draft events.
  const event = await prisma.event.findUnique({
    where,
    include: {
      registrations: {
        include: { items: { include: { attendees: true, ticketType: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 10000,
      },
    },
  })
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // customQuestions/customAnswers are Prisma Json — a bare cast (/AUDIT-068)
  // trusts the column shape; a malformed value (object instead of array, missing
  // fields) crashes `.map` or emits garbage. Validate the shape at the boundary.
  const rawQuestions = Array.isArray(event.customQuestions) ? event.customQuestions : []
  const questions = rawQuestions
    .filter(
      (q): q is { id: string; label: string } =>
        !!q &&
        typeof q === "object" &&
        typeof (q as { id?: unknown }).id === "string" &&
        typeof (q as { label?: unknown }).label === "string"
    )
    .map((q) => {
      const t = (q as { type?: unknown }).type
      const s = (q as { scope?: unknown }).scope
      return {
        id: q.id,
        label: q.label,
        type: typeof t === "string" ? t : undefined,
        scope: s === "attendee" || s === "order" ? (s as "attendee" | "order") : ("order" as const),
      }
    })

  const csv = generateCsv(
    event.registrations.map(r => ({
      ...r,
      email: r.email ? safeDecrypt(r.email) : "",
      phone: r.phone ? safeDecrypt(r.phone) : null,
      customAnswers: toAnswerMap(r.customAnswers),
      totalAmount: r.totalAmount.toString(),
      items: r.items.map(item => ({
        ...item,
        attendees: item.attendees.map(a => ({
          name: a.name,
          answers: toAnswerMap(a.answers),
        })),
      })),
    })),
    questions
  )

  const userId = actorId(session)
  const ip = auditIpFromRequest(req)
  // event.id is already the resourceId — log the row count instead of repeating
  // it, and keep decrypted PII out of audit metadata.
  await logAudit(userId, "EXPORT_CSV", "Event", event.id, { rowCount: event.registrations.length }, ip)

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="registrations-${event.id}.csv"`,
      "cache-control": "no-store",
    },
  })
}
