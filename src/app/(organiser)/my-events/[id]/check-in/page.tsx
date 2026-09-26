import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { canManageEvent } from "@/lib/eventManager"
import Link from "next/link"
import { CheckInList } from "@/components/events/CheckInList"
import { parseRouteId } from "@/lib/validation"

type Props = { params: Promise<{ id: string }> }

export default async function OrganiserCheckInPage(props: Props) {
  const params = await props.params
  const session = await auth()
  if (!session) redirect("/login")

  const eventId = parseRouteId(params.id)
  if (eventId === null) notFound()

  // IDOR gate: an unassigned event is indistinguishable from a missing one.
  const userId = Number.parseInt(session.user.id, 10)
  if (!(await canManageEvent(userId, eventId, session.user.role))) notFound()

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      // CANCELLED registrations are not attending — exclude. select (not include)
      // so no email/phone PII reaches this view.
      registrations: {
        where: { paymentStatus: { not: "CANCELLED" } },
        select: {
          publicToken: true,
          firstName: true,
          lastName: true,
          items: {
            select: {
              ticketType: { select: { name: true } },
              attendees: { select: { id: true, name: true, checkedInAt: true } },
            },
          },
        },
      },
    },
  })
  if (!event) notFound()

  const attendees = event.registrations.flatMap(r =>
    r.items.flatMap(it =>
      it.attendees.map(a => ({
        attendeeId: a.id,
        name: a.name,
        ticketName: it.ticketType.name,
        registrantName: `${r.firstName} ${r.lastName}`,
        ref: r.publicToken,
        checkedIn: a.checkedInAt !== null,
      })),
    ),
  )

  return (
    <div>
      <Link href={`/my-events/${eventId}/registrations`} className="text-xs text-muted-foreground hover:text-foreground mb-1 inline-block">
        ← Registrations
      </Link>
      <h1 className="text-2xl font-bold text-foreground mb-4">Check-in · {event.title}</h1>
      <CheckInList eventId={eventId} attendees={attendees} />
    </div>
  )
}
