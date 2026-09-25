import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { generateCsv } from "@/lib/eventExport"
import { canEdit } from "@/lib/roleGuard"
import { isEventManager } from "@/lib/eventManager"
import { safeDecrypt } from "@/lib/crypto"
import { toAnswerMap } from "@/lib/eventAnswers"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const isEditor = canEdit(session.user.role)
  // Non-editors may only be an assigned event organiser; defer the per-event
  // membership check until after the slug→event lookup below.
  if (!isEditor && session.user.role !== "EVENT_ORGANISER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!rateLimit(`export:event:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // Look up by slug to match the [slug] route segment — the public register
  // endpoint under the same segment also resolves by slug. Next.js forbids
  // sibling [id]/[slug] segments, so the route param is the slug, not an id.
  const slug = params.slug
  if (!slug) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 })
  }
  // For a non-editor organiser, check per-event ownership on a cheap lookup
  // before running the heavy registrations+attendees join — otherwise
  // an organiser can force that full query against events they don't manage.
  const eventStub = await prisma.event.findUnique({ where: { slug }, select: { id: true } })
  if (!eventStub) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isEditor && !(await isEventManager(parseInt(session.user.id, 10), eventStub.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Draft events are exportable by editors: this route already requires a
  // canEdit session and resolves by slug, so the old isPublished 404 blocked
  // no real enumeration — it only 404'd admins managing their own draft events.
  const event = await prisma.event.findUnique({
    where: { slug },
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
  const ip = getClientIp(req)
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
