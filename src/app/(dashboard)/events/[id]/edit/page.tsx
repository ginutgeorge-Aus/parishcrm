import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { canEdit, isAdmin } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { updateEvent, deleteEvent } from "@/lib/actions/event"
import { EventForm } from "@/components/events/EventForm"
import { EventSavedBanner } from "@/components/events/EventSavedBanner"
import { PublishToggle } from "@/components/events/PublishToggle"
import { CloseRegistrationToggle } from "@/components/events/CloseRegistrationToggle"
import { DeleteEventButton } from "@/components/events/DeleteEventButton"
import { toSydneyDatetimeLocal } from "@/lib/dates"
import { parseRouteId } from "@/lib/validation"

type Props = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ saved?: string }>
}

export default async function EditEventPage(props: Props) {
  const params = await props.params;
  const { saved } = (await props.searchParams) ?? {};
  const session = await auth()
  if (!session) redirect("/login")
  if (!canEdit(session.user.role)) redirect("/events")

  const eventId = parseRouteId(params.id)
  if (eventId === null) notFound()

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { ticketTypes: true, images: { select: { kind: true } } },
  })
  if (!event) notFound()

  const updateAction = updateEvent.bind(null, event.id)
  const boundDelete = deleteEvent.bind(null, event.id)
  // Return (not swallow) the result so a delete failure surfaces its error to
  // DeleteEventButton instead of silently doing nothing. On success
  // deleteEvent redirect()s, so this only ever returns the error branch.
  async function deleteAction() {
    "use server"
    return boundDelete()
  }

  const toLocalDatetime = (d: Date) => toSydneyDatetimeLocal(d)

  type RawQuestion = { id?: string; label: string; type: string; required: boolean; options?: string[]; body?: string; ticketTypeNames?: string[]; scope?: "order" | "attendee"; allowOther?: boolean; statements?: string[] }
  const customQuestions = (Array.isArray(event.customQuestions) ? (event.customQuestions as RawQuestion[]) : []).map((q: RawQuestion) => ({
    id: q.id,
    label: q.label,
    type: q.type as import("@/lib/eventQuestions").CustomQuestionType,
    required: q.required,
    options: (q.options ?? []).join(", "),
    body: q.body ?? "",
    ticketTypeNames: JSON.stringify(q.ticketTypeNames ?? []),
    scope: q.scope ?? "order",
    allowOther: q.allowOther ?? false,
    statements: (q.statements ?? []).join("\n"),
  }))

  const organizers = (Array.isArray(event.organizers) ? event.organizers : []).map(
    (o) => o as unknown as import("@/lib/eventOrganizers").Organizer,
  )

  return (
    <div className="p-6">
      <Link href="/events" className="text-xs text-muted-foreground hover:text-muted-foreground mb-1 inline-block">
        ← Events
      </Link>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{event.title}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Public link:{" "}
            <a
              href={`/e/${event.slug}`}
              target="_blank"
              className="text-primary underline"
            >
              /e/{event.slug}
            </a>
          </p>
        </div>
        <div className="flex gap-2">
          <PublishToggle eventId={event.id} isPublished={event.isPublished} />
          <CloseRegistrationToggle eventId={event.id} registrationClosed={event.registrationClosed} />
          {isAdmin(session.user.role) && (
            <DeleteEventButton action={deleteAction} size="lg" />
          )}
        </div>
      </div>

      {saved && <EventSavedBanner />}

      <EventForm
        action={updateAction}
        defaultValues={{
          title: event.title,
          slug: event.slug,
          description: event.description ?? "",
          kind: event.kind,
          category: event.category,
          date: event.date ? toLocalDatetime(event.date) : "",
          endDate: event.endDate ? toLocalDatetime(event.endDate) : "",
          registrationDeadline: event.registrationDeadline ? toLocalDatetime(event.registrationDeadline) : "",
          recurs: event.recurs ?? "",
          recursLabel: event.recursLabel ?? "",
          startTime: event.startTime ?? "",
          location: event.location ?? "",
          bankBsb: event.bankBsb ?? "",
          bankAccount: event.bankAccount ?? "",
          onlinePaymentEnabled: event.onlinePaymentEnabled,
          passCardFee: event.passCardFee,
          familyWaiverEnabled: event.familyWaiverEnabled,
          familyWaiverThreshold: event.familyWaiverThreshold?.toString() ?? "4",
          tieredPricingEnabled: event.tieredPricingEnabled,
          familyPricingTiers: Array.isArray(event.familyPricingTiers)
            ? (event.familyPricingTiers as number[]).map((n) => String(n))
            : [],
          imageUrl: event.imageUrl ?? "",
          reminderDaysBefore: event.reminderDaysBefore?.toString() ?? "",
          hasBanner: event.images.some((i) => i.kind === "BANNER"),
          hasPoster: event.images.some((i) => i.kind === "POSTER"),
          updatedAt: event.updatedAt,
          ticketTypes: event.ticketTypes.map(tt => ({
            id: tt.id.toString(),
            name: tt.name,
            price: Number.parseFloat(tt.price.toString()).toFixed(2),
            capacity: tt.capacity?.toString() ?? "",
            countsTowardWaiver: tt.countsTowardWaiver ? "true" : "false",
          })),
          customQuestions,
          organizers,
        }}
      />
    </div>
  )
}
