import Link from "next/link"
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { canManageEvent } from "@/lib/eventManager"
import { safeDecrypt } from "@/lib/crypto"
import { centsToNumber, toCents } from "@/lib/formatting"
import { toFloat } from "@/lib/utils"
import { formatSydneyDate } from "@/lib/dates"
import { lastRemindedAtByRegistration } from "@/lib/actions/registration"
import { RegistrationStats } from "@/components/events/RegistrationStats"
import { RegistrationsTable } from "@/components/events/RegistrationsTable"
import { ExportButtons } from "@/components/events/ExportButtons"
import { SendPaymentRemindersClient } from "@/components/events/SendPaymentRemindersClient"
import type { PendingReminderRow } from "@/components/events/SendPaymentRemindersClient"
import { Button } from "@/components/ui/button"

// Same defensive cap as the admin twin (events/[id]/registrations/page.tsx,
// ) on the registration rows decrypted (email/phone) and shipped to the
// client — without it a high-volume event reintroduces the exact perf/decrypt
// cost problem fixed on the admin route, just on the organiser-facing
// path. Headline stats come from a DB rollup below so they stay exact
// past the cap; the table shows a "newest N of M" notice when truncated.
const EVENT_REGISTRATIONS_CAP = 2000

type Props = { params: Promise<{ id: string }> }

export default async function OrganiserRegistrationsPage(props: Props) {
  const { id } = await props.params
  const session = await auth()
  if (!session) redirect("/login")

  const eventId = parseInt(id, 10)
  if (isNaN(eventId) || eventId <= 0 || eventId > 2147483647) notFound()

  // IDOR gate: an unassigned event is indistinguishable from a missing one.
  const userId = parseInt(session.user.id, 10)
  if (!(await canManageEvent(userId, eventId, session.user.role))) notFound()

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      ticketTypes: {
        include: {
          registrationItems: {
            where: { registration: { paymentStatus: { not: "CANCELLED" } } },
            select: { quantity: true },
          },
        },
      },
      registrations: {
        include: {
          items: { include: { attendees: { select: { name: true } }, ticketType: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: EVENT_REGISTRATIONS_CAP,
      },
      _count: { select: { registrations: true } },
    },
  })
  if (!event) notFound()

  // Headline stats come from a DB rollup over ALL registrations, not the
  // capped list above — so total/paid/cancelled/revenue stay exact even when
  // the table is truncated, matching the admin twin.
  const statusRollup = await prisma.registration.groupBy({
    by: ["paymentStatus"],
    where: { eventId },
    _count: { _all: true },
    _sum: { totalAmount: true },
  })
  const countOf = (status: string) => statusRollup.find((r) => r.paymentStatus === status)?._count._all ?? 0
  const totalRegistrations = event._count.registrations
  const paidCount = countOf("PAID")
  const cancelled = countOf("CANCELLED")
  const revenue = centsToNumber(toCents(statusRollup.find((r) => r.paymentStatus === "PAID")?._sum.totalAmount))
  const ticketsSold = event.ticketTypes.map((tt) => ({
    name: tt.name,
    count: tt.registrationItems.reduce((s, i) => s + i.quantity, 0),
  }))

  const lastReminded = await lastRemindedAtByRegistration(event.id)
  const reminderRows: PendingReminderRow[] = event.registrations
    .filter((r) => r.paymentStatus === "PENDING")
    .map((r) => ({
      registrationId: r.id,
      name: `${r.firstName} ${r.lastName}`.trim(),
      email: r.email ? safeDecrypt(r.email) : null,
      amountDue: toFloat(r.totalAmount),
      lastRemindedAt: lastReminded[r.id] ?? null,
    }))

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link href="/my-events" className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">
            ← My Events
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{event.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {event.date ? formatSydneyDate(event.date) : event.recursLabel || "Recurring"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/my-events/${eventId}/check-in`}>Check-in</Link>
          </Button>
          <ExportButtons eventId={eventId} slug={event.slug} />
          <SendPaymentRemindersClient eventId={event.id} eventTitle={event.title} rows={reminderRows} />
        </div>
      </div>

      <RegistrationStats
        total={totalRegistrations}
        paid={paidCount}
        cancelled={cancelled}
        revenue={revenue}
        ticketsSold={ticketsSold}
      />

      <RegistrationsTable
        registrations={event.registrations.map((r) => ({
          ...r,
          email: r.email ? safeDecrypt(r.email) : "",
          phone: r.phone ? safeDecrypt(r.phone) : null,
          totalAmount: parseFloat(r.totalAmount.toString()),
        }))}
        total={totalRegistrations}
        eventId={eventId}
        canEdit={false}
      />
    </div>
  )
}
