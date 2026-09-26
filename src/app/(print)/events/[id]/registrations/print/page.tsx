import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canManageEvent } from "@/lib/eventManager"
import { logAudit } from "@/lib/audit"
import { auditIpFromHeaders } from "@/lib/clientIp"
import { safeDecrypt } from "@/lib/crypto"
import { toAnswerMap } from "@/lib/eventAnswers"
import { fmtAUD } from "@/lib/formatting"
import { formatAnswerForCsv } from "@/lib/eventQuestions"
import { redirect, notFound } from "next/navigation"
import { headers } from "next/headers"
import { formatSydneyDate, formatSydneyTime } from "@/lib/dates"
import { PrintButton } from "@/components/ui/PrintButton"

type Props = { params: Promise<{ id: string }> }

export default async function PrintPage(props: Props) {
  const params = await props.params;
  const session = await auth()
  if (!session) redirect("/login")
  // Production CSP nonces style-src; the print <style> needs the nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined
  const eventId = Number.parseInt(params.id, 10)
  // Reject non-numeric/out-of-range ids before they reach Postgres, matching the
  // petty-cash print page guard.
  if (Number.isNaN(eventId) || eventId <= 0 || eventId > 2147483647) notFound()
  // Renders decrypted registrant PII + payment status — gate to edit roles or an
  // assigned event organiser for this event. VIEWER/AUDITOR must not reach it
  // directly.
  const userId = Number.parseInt(session.user.id, 10)
  if (!(await canManageEvent(userId, eventId, session.user.role))) redirect("/")
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      registrations: {
        include: { items: { include: { attendees: true, ticketType: { select: { name: true } } } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })
  if (!event) notFound()

  // Decrypts + prints registrant PII — audit on access, matching the P&L and
  // directory print pages.
  const ip = auditIpFromHeaders(await headers())
  await logAudit(actorId(session), "EXPORT_EVENT_REGISTRATIONS", "Event", eventId, { eventTitle: event.title }, ip)

  // Validate customQuestions shape (same guard as CSV export,/AUDIT-068).
  const rawQuestions = Array.isArray(event.customQuestions) ? event.customQuestions : []
  const customQuestions = rawQuestions
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

  const attendees = event.registrations.flatMap(r =>
    r.items.flatMap(item => {
      const names = item.attendees.length > 0
        ? item.attendees.map((a: { name: string }) => a.name)
        : Array<string>(item.quantity).fill("—")
      return names.map(name => ({
        name,
        ticketType: item.ticketType.name,
        bookedBy: `${r.firstName} ${r.lastName}`,
        paymentStatus: r.paymentStatus,
      }))
    })
  )

  return (
    <>
      <div className="print:hidden">
        <PrintButton />
      </div>
      <style nonce={nonce}>{`
        /* Print-scoped palette — CSS vars defined here apply reliably in @media print (unlike app :root tokens). */
        :root { --c-muted: #666; --c-border: #e2e8f0; --c-th-bg: #f1f5f9; --c-paid: #16a34a; --c-pending: #a16207; --c-cancelled: #dc2626; }
        body { font-family: sans-serif; font-size: 12px; margin: 24px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        h2 { font-size: 14px; margin: 24px 0 8px; }
        p { color: var(--c-muted); margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: var(--c-th-bg); border: 1px solid var(--c-border); padding: 6px 10px; text-align: left; font-size: 11px; text-transform: uppercase; }
        td { border: 1px solid var(--c-border); padding: 6px 10px; }
        .paid { color: var(--c-paid); font-weight: 600; }
        .pending { color: var(--c-pending); }
        .cancelled { color: var(--c-cancelled); opacity: 0.6; }
        @media print { body { margin: 0; } }
      `}</style>
      <h1>{event.title}</h1>
      <p>{event.date ? `${formatSydneyDate(event.date)} · ${formatSydneyTime(event.date)}` : (event.recursLabel || "Recurring")} · {event.registrations.length} registrations</p>
      <table>
        <thead>
          <tr>
            <th>Ref</th>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Tickets</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {event.registrations.map(r => (
            <tr key={r.id}>
              <td>{r.publicToken}</td>
              <td>{r.firstName} {r.lastName}</td>
              <td>{r.email ? safeDecrypt(r.email) : "—"}</td>
              <td>{r.phone ? safeDecrypt(r.phone) : "—"}</td>
              <td>
                {r.items.map((i, idx) => (
                  <div key={idx}>
                    {i.quantity}× {i.ticketType.name}
                    {i.attendees.length > 0 && `: ${i.attendees.map((a: { name: string }) => a.name).join(", ")}`}
                  </div>
                ))}
              </td>
              <td>{fmtAUD(Number(r.totalAmount))}</td>
              <td className={r.paymentStatus.toLowerCase()}>{r.paymentStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Attendees · {attendees.length}</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Ticket</th>
            <th>Booked by</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {attendees.map((a, idx) => (
            <tr key={idx}>
              <td>{a.name}</td>
              <td>{a.ticketType}</td>
              <td>{a.bookedBy}</td>
              <td className={a.paymentStatus.toLowerCase()}>{a.paymentStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {customQuestions.length > 0 && (
        <>
          <h2>Custom answers</h2>
          <table>
            <thead>
              <tr>
                <th>Ref</th>
                <th>Attendee</th>
                <th>Ticket</th>
                {customQuestions.map(q => <th key={q.id}>{q.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {event.registrations.flatMap(r => {
                const orderAnswers = toAnswerMap(r.customAnswers)
                const ref = r.publicToken
                // Flatten to one row per attendee (Attendee model) or per quantity (no rows).
                const rows: { name: string; ticket: string; attendeeAnswers: Record<string, string | string[]> | null }[] = []
                for (const item of r.items) {
                  if (item.attendees.length > 0) {
                    for (const a of item.attendees) {
                      rows.push({ name: a.name, ticket: item.ticketType.name, attendeeAnswers: toAnswerMap(a.answers) })
                    }
                  } else {
                    for (const name of Array<string>(item.quantity).fill("—")) rows.push({ name, ticket: item.ticketType.name, attendeeAnswers: null })
                  }
                }
                return rows.map((row, idx) => (
                  <tr key={`${r.id}-${idx}`}>
                    <td>{idx === 0 ? ref : ""}</td>
                    <td>{row.name}</td>
                    <td style={{ fontSize: "11px" }}>{row.ticket}</td>
                    {customQuestions.map(q => (
                      <td key={q.id} style={{ fontSize: "11px" }}>
                        {q.scope === "attendee"
                          ? (formatAnswerForCsv(row.attendeeAnswers?.[q.id], q.type) || "—")
                          : (idx === 0 ? (formatAnswerForCsv(orderAnswers?.[q.id], q.type) || "—") : "")}
                      </td>
                    ))}
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}
