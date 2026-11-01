import Link from "next/link"
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canManageEvent } from "@/lib/eventManager"
import { updateManagedEvent } from "@/lib/actions/eventManaged"
import { ManagedEventForm } from "@/components/events/ManagedEventForm"
import { EventSavedBanner } from "@/components/events/EventSavedBanner"
import { toSydneyDatetimeLocal } from "@/lib/dates"
import { parseRouteId } from "@/lib/validation"
import type { Organizer } from "@/lib/eventOrganizers"

type Props = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ saved?: string }>
}

/**
 * Organiser-facing details editor for one managed event (OSS-41). Guarded at
 * the page (404 for anyone who can't manage the event, as for the sibling
 * registrations page) and again in `updateManagedEvent`.
 *
 * @param props - Route params and search params.
 * @returns The edit page.
 */
export default async function EditManagedEventPage(props: Readonly<Props>) {
  const { id } = await props.params
  const { saved } = (await props.searchParams) ?? {}
  const session = await auth()
  if (!session?.user) redirect("/login")

  const eventId = parseRouteId(id)
  if (eventId === null) notFound()

  // IDOR gate: an unassigned event is indistinguishable from a missing one.
  const userId = actorId(session)
  if (!(await canManageEvent(userId, eventId, session.user.role))) notFound()

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, slug: true, kind: true, title: true, description: true, category: true, date: true,
      endDate: true, recurs: true, recursLabel: true, startTime: true, location: true,
      organizers: true, updatedAt: true, images: { select: { kind: true } },
    },
  })
  if (!event) notFound()

  const action = updateManagedEvent.bind(null, event.id)
  const organizers = (Array.isArray(event.organizers) ? event.organizers : []) as unknown as Organizer[]

  return (
    <div>
      <Link href="/my-events" className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">
        ← My Events
      </Link>
      <h1 className="mb-1 text-2xl font-bold text-foreground">{event.title}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Edit the public details. Pricing, publishing and registration settings are managed by an editor.
      </p>
      {saved && <EventSavedBanner />}
      <ManagedEventForm
        action={action}
        kind={event.kind === "recurring" ? "recurring" : "one_off"}
        defaultValues={{
          slug: event.slug,
          title: event.title,
          description: event.description ?? "",
          category: event.category,
          date: event.date ? toSydneyDatetimeLocal(event.date) : "",
          endDate: event.endDate ? toSydneyDatetimeLocal(event.endDate) : "",
          recurs: event.recurs ?? "",
          recursLabel: event.recursLabel ?? "",
          startTime: event.startTime ?? "",
          location: event.location ?? "",
          hasBanner: event.images.some((i) => i.kind === "BANNER"),
          hasPoster: event.images.some((i) => i.kind === "POSTER"),
          organizers,
          updatedAt: event.updatedAt,
        }}
      />
    </div>
  )
}
