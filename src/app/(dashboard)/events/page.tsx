import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import Link from "next/link"
import { formatSydneyDate } from "@/lib/dates"
import { canEdit, isAdmin, canViewPeople } from "@/lib/roleGuard"
import { deleteEvent } from "@/lib/actions/event"
import { DeleteEventButton } from "@/components/events/DeleteEventButton"
import { ResyncEventsButton } from "@/components/events/ResyncEventsButton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtAUD } from "@/lib/formatting"
import { rollupEventStats } from "@/lib/eventStats"
import { isWebsiteSyncConfigured } from "@/lib/websiteSync"

export default async function EventsPage(
  props: {
    searchParams: Promise<{ filter?: string }>
  }
) {
  const searchParams = await props.searchParams;
  const session = await auth()
  if (!session) redirect("/login")
  // Events list shows registration counts + ticket revenue — member-facing data.
  // AUDITOR is accounting-only, so gate on canViewPeople like other people lists.
  if (!canViewPeople(session.user.role)) redirect("/")

  const now = new Date()
  const filter = searchParams.filter ?? "upcoming"

  const events = await prisma.event.findMany({
    where:
      filter === "upcoming"
        ? { OR: [{ date: { gte: now } }, { kind: "recurring" }] }
        : filter === "past"
        ? { date: { lt: now } }
        : undefined,
    // date is nullable for recurring events — pin them after dated rows with a
    // stable secondary key, otherwise NULL ordering varies between page loads.
    orderBy: [
      { date: { sort: filter === "past" ? "desc" : "asc", nulls: "last" } },
      { id: "asc" },
    ],
    include: {
      // Only the ticketType ids — enough to roll per-ticketType sold counts back
      // up to their event. Revenue + tickets-sold are aggregated in the DB below
      // instead of loading every registration/registrationItem row.
      ticketTypes: { select: { id: true } },
    },
  })

  const eventIds = events.map((e) => e.id)
  const ttToEvent = new Map<number, number>()
  for (const e of events) for (const tt of e.ticketTypes) ttToEvent.set(tt.id, e.id)
  const ticketTypeIds = [...ttToEvent.keys()]

  const [revenueRows, soldRows] = await Promise.all([
    eventIds.length
      ? prisma.registration.groupBy({
          by: ["eventId"],
          where: { eventId: { in: eventIds }, paymentStatus: "PAID" },
          _sum: { totalAmount: true },
        })
      : Promise.resolve([]),
    ticketTypeIds.length
      ? prisma.registrationItem.groupBy({
          by: ["ticketTypeId"],
          // Cancelled registrations must not count toward tickets sold (#bug:
          // matches capacity check, which filters `not: CANCELLED`).
          where: { ticketTypeId: { in: ticketTypeIds }, registration: { paymentStatus: { not: "CANCELLED" } } },
          _sum: { quantity: true },
        })
      : Promise.resolve([]),
  ])

  const eventStats = rollupEventStats(ttToEvent, revenueRows, soldRows)
  const statsFor = (id: number) => eventStats.get(id) ?? { ticketsSold: 0, revenue: 0 }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-foreground">Events</h1>
        <div className="flex items-center gap-3">
          {isAdmin(session.user.role) && isWebsiteSyncConfigured() && <ResyncEventsButton />}
          {canEdit(session.user.role) && (
            <Button asChild>
              <Link href="/events/new">New Event</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {["upcoming", "past", "all"].map(f => (
          <Button
            key={f}
            asChild
            size="sm"
            variant={filter === f ? "default" : "outline"}
            className="capitalize"
          >
            <Link href={`/events?filter=${f}`}>{f}</Link>
          </Button>
        ))}
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {events.length === 0 && (
          <li className="rounded-lg border bg-card py-12 text-center">
            <p className="font-medium text-muted-foreground">No events found.</p>
          </li>
        )}
        {events.map(event => {
          const { ticketsSold, revenue } = statsFor(event.id)
          return (
            <li key={event.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="truncate font-semibold text-foreground" title={event.title}>{event.title}</span>
                <Badge
                  className={
                    event.isPublished
                      ? "bg-income/10 text-income shrink-0"
                      : "bg-muted text-muted-foreground shrink-0"
                  }
                >
                  {event.isPublished ? "Published" : "Draft"}
                </Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {event.date ? formatSydneyDate(event.date) : (event.recursLabel || "Recurring")}
                {ticketsSold > 0 && ` · ${ticketsSold} ticket${ticketsSold === 1 ? "" : "s"}`}
                {revenue > 0 && ` · ${fmtAUD(revenue)}`}
              </div>
              <div className="mt-2 flex items-center gap-1">
                {canViewPeople(session.user.role) && (
                  <Button asChild variant="link" size="xs" className="px-0">
                    <Link href={`/events/${event.id}/registrations`}>Registrations</Link>
                  </Button>
                )}
                {canEdit(session.user.role) && (
                  <Button asChild variant="link" size="xs" className="text-muted-foreground">
                    <Link href={`/events/${event.id}/edit`}>Edit</Link>
                  </Button>
                )}
                {isAdmin(session.user.role) && (
                  <DeleteEventButton
                    action={deleteEvent.bind(null, event.id)}
                    size="xs"
                    confirmMessage="Delete this event?"
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Desktop: table */}
      <div className="hidden md:block bg-card rounded-xl border border-border overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              {["Event", "Date", "Status", "Tickets Sold", "Revenue", "Actions"].map(h => (
                <TableHead key={h} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No events found.
                </TableCell>
              </TableRow>
            )}
            {events.map(event => {
              const { ticketsSold, revenue } = statsFor(event.id)

              return (
                <TableRow key={event.id}>
                  <TableCell className="max-w-[20rem] truncate font-semibold text-foreground" title={event.title}>{event.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.date ? formatSydneyDate(event.date) : (event.recursLabel || "Recurring")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        event.isPublished
                          ? "bg-income/10 text-income"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {event.isPublished ? "Published" : "Draft"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{ticketsSold}</TableCell>
                  <TableCell className="tabular font-semibold text-foreground">{fmtAUD(revenue)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {canViewPeople(session.user.role) && (
                        <Button asChild variant="link" size="xs">
                          <Link href={`/events/${event.id}/registrations`}>Registrations</Link>
                        </Button>
                      )}
                      {canEdit(session.user.role) && (
                        <Button asChild variant="link" size="xs" className="text-muted-foreground">
                          <Link href={`/events/${event.id}/edit`}>Edit</Link>
                        </Button>
                      )}
                      {isAdmin(session.user.role) && (
                        <DeleteEventButton
                          action={deleteEvent.bind(null, event.id)}
                          size="xs"
                          confirmMessage="Delete this event?"
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
