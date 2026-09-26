import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { canEdit, canViewPeople, isAdmin } from "@/lib/roleGuard"
import { resetEventRegistrations, lastRemindedAtByRegistration } from "@/lib/actions/registration"
import { DeleteEventButton } from "@/components/events/DeleteEventButton"
import { safeDecrypt } from "@/lib/crypto"
import { centsToNumber, toCents } from "@/lib/formatting"
import { toFloat } from "@/lib/utils"
import { formatSydneyDate } from "@/lib/dates"
import Link from "next/link"
import { RegistrationStats } from "@/components/events/RegistrationStats"
import { EventAnalytics } from "@/components/events/EventAnalytics"
import { fillRates, revenueByType, regsOverTime } from "@/lib/reports/eventAnalytics"
import { RegistrationsTable } from "@/components/events/RegistrationsTable"
import { ExportButtons } from "@/components/events/ExportButtons"
import { SendPaymentRemindersClient } from "@/components/events/SendPaymentRemindersClient"
import type { PendingReminderRow } from "@/components/events/SendPaymentRemindersClient"
import { VolunteerViewToggle } from "@/components/events/VolunteerViewToggle"
import { EventManagersPanel } from "@/components/events/EventManagersPanel"
import { listAssignableOrganisers } from "@/lib/actions/eventAccess"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

// Defensive cap on the registration rows we decrypt (email/phone) and ship to
// the client table. Church events run to the hundreds; 2000 is headroom.
// Headline stats + revenue come from a DB groupBy below so they stay exact past
// the cap, and the table shows a "newest N of M" notice when truncated.
const EVENT_REGISTRATIONS_CAP = 2000

type Props = { params: Promise<{ id: string }> }

export default async function RegistrationsPage(props: Props) {
  const params = await props.params;
  const session = await auth()
  if (!session) redirect("/login")
  if (!canViewPeople(session.user.role)) redirect("/")

  const eventId = Number.parseInt(params.id, 10)
  if (Number.isNaN(eventId) || eventId <= 0 || eventId > 2147483647) notFound()

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      ticketTypes: {
        include: {
          // Exclude cancelled registrations from tickets-sold + fill-rate
          // counts (matches capacity check, which filters `not: CANCELLED`).
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
      _count: { select: { waitlist: true, checkoutSessions: true, registrations: true } },
    },
  })
  if (!event) notFound()

  const [managers, assignable] = canEdit(session.user.role)
    ? await Promise.all([
        prisma.eventManager.findMany({
          where: { eventId },
          select: { user: { select: { id: true, name: true, email: true } } },
        }).then((rows) => rows.map((r) => r.user)),
        listAssignableOrganisers(),
      ])
    : [[], []]

  // Headline stats come from a DB rollup over ALL registrations, not the capped
  // list above — so total/paid/cancelled/revenue stay exact even when the table
  // is truncated.
  const statusRollup = await prisma.registration.groupBy({
    by: ["paymentStatus"],
    where: { eventId },
    _count: { _all: true },
    _sum: { totalAmount: true },
  })
  const countOf = (status: string) => statusRollup.find(r => r.paymentStatus === status)?._count._all ?? 0
  const totalRegistrations = event._count.registrations
  const paidCount = countOf("PAID")
  const cancelled = countOf("CANCELLED")
  const revenue = centsToNumber(toCents(statusRollup.find(r => r.paymentStatus === "PAID")?._sum.totalAmount))

  const ticketsSold = event.ticketTypes.map(tt => ({
    name: tt.name,
    count: tt.registrationItems.reduce((s, i) => s + i.quantity, 0),
  }))

  // Analytics charts iterate the loaded (capped) registration list. At church
  // scale this is always the full set; only a >2000-registration event would see
  // the charts reflect the newest 2000 (the exact headline figures above and the
  // CSV export remain complete).
  const analyticsFill = fillRates(event.ticketTypes)
  const analyticsRevenue = revenueByType(event.registrations)
  const analyticsTime = regsOverTime(event.registrations.filter(r => r.paymentStatus !== "CANCELLED"))

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

  // Bound reset action — only ever invoked by the ADMIN-draft button below;
  // the action re-checks both guards server-side regardless.
  async function resetAction(): Promise<{ error?: string } | undefined> {
    "use server"
    return resetEventRegistrations(eventId)
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <Link href="/events" className="text-xs text-muted-foreground hover:text-foreground mb-1 inline-block">
            ← Events
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{event.title}</h1>
          <p className="text-muted-foreground text-sm mt-1">{event.date ? formatSydneyDate(event.date) : (event.recursLabel || "Recurring")}</p>
        </div>
        <div className="flex gap-2 items-center">
          {canEdit(session.user.role) ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/events/${eventId}/check-in`}>Check-in</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/events/${eventId}/waitlist`}>Waitlist</Link>
              </Button>
              <ExportButtons eventId={eventId} slug={event.slug} />
              <SendPaymentRemindersClient eventId={event.id} eventTitle={event.title} rows={reminderRows} />
              {!event.isPublished && isAdmin(session.user.role) && (
                <DeleteEventButton
                  action={resetAction}
                  variant="outline"
                  confirmMessage={`Delete all ${totalRegistrations} registration(s), ${event._count.waitlist} waitlist entr(y/ies) and ${event._count.checkoutSessions} checkout session(s) for this draft event? This cannot be undone.`}
                >
                  Reset registrations
                </DeleteEventButton>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Exporting requires an editor role.</p>
          )}
          <Badge
            className={
              event.isPublished ? "bg-income/10 text-income" : "bg-muted text-muted-foreground"
            }
          >
            {event.isPublished ? "Published" : "Draft"}
          </Badge>
        </div>
      </div>

      {canEdit(session.user.role) && (
        <VolunteerViewToggle eventId={eventId} slug={event.slug} initialToken={event.volunteerToken} />
      )}

      {canEdit(session.user.role) && (
        <EventManagersPanel eventId={eventId} managers={managers} assignable={assignable} />
      )}

      <RegistrationStats
        total={totalRegistrations}
        paid={paidCount}
        cancelled={cancelled}
        revenue={revenue}
        ticketsSold={ticketsSold}
      />

      <EventAnalytics
        fillRates={analyticsFill}
        revenueByType={analyticsRevenue}
        regsOverTime={analyticsTime}
      />

      <RegistrationsTable
        registrations={event.registrations.map(r => ({
          ...r,
          email: r.email ? safeDecrypt(r.email) : "",
          phone: r.phone ? safeDecrypt(r.phone) : null,
          totalAmount: Number.parseFloat(r.totalAmount.toString()),
        }))}
        total={totalRegistrations}
        eventId={eventId}
        canEdit={canEdit(session.user.role)}
      />
    </div>
  )
}
