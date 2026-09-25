import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { canEdit } from "@/lib/roleGuard"
import { createEvent } from "@/lib/actions/event"
import { EventForm } from "@/components/events/EventForm"

export default async function NewEventPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!canEdit(session.user.role)) redirect("/events")

  return (
    <div className="p-6">
      <Link href="/events" className="text-xs text-muted-foreground hover:text-muted-foreground mb-1 inline-block">
        ← Events
      </Link>
      <h1 className="text-2xl font-bold text-foreground mb-6">New Event</h1>
      <EventForm action={createEvent} />
    </div>
  )
}
