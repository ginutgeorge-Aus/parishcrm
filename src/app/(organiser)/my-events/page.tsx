import Link from "next/link"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { formatSydneyDate } from "@/lib/dates"

export default async function MyEventsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const userId = parseInt(session.user.id, 10)

  // Editors see nothing special here (they use the main dashboard); organisers
  // see exactly their assigned events.
  const links = await prisma.eventManager.findMany({
    where: { userId },
    select: { event: { select: { id: true, title: true, date: true, recursLabel: true, _count: { select: { registrations: true } } } } },
    orderBy: { event: { date: "desc" } },
  })
  const events = links.map((l) => l.event)

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">My Events</h1>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No events assigned to you yet. An administrator will add you to the events you organise.
        </p>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/my-events/${e.id}/registrations`}
                className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors duration-200 hover:bg-accent"
              >
                <div>
                  <p className="font-medium text-foreground">{e.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {e.date ? formatSydneyDate(e.date) : e.recursLabel || "Recurring"}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">{e._count.registrations} registrations</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canEdit(session.user.role) && (
        <p className="mt-6 text-xs text-muted-foreground">
          You are viewing this as an editor. Organisers see only events assigned to them.
        </p>
      )}
    </div>
  )
}
