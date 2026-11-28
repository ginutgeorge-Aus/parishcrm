import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageRoster } from "@/lib/roleGuard"
import { formatSydneyDate, formatSydneyTime } from "@/lib/dates"
import { parseRouteId } from "@/lib/validation"
import { AddSlotForm } from "@/components/roster/AddSlotForm"
import { SlotCard } from "@/components/roster/SlotCard"

type Props = { params: Promise<{ id: string }> }

/**
 * One service's roster grid: a card per role with the people rostered, open
 * places and an assign dropdown fed by the conflict-aware suggestions.
 * canManageRoster only.
 */
export default async function RosterServicePage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canManageRoster(session.user.role)) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()

  const service = await prisma.rosterService.findUnique({
    where: { id },
    select: {
      id: true, title: true, startsAt: true, endsAt: true, location: true,
      slots: {
        orderBy: { role: { name: "asc" } },
        select: {
          id: true, needed: true, roleId: true,
          role: { select: { name: true } },
          assignments: {
            orderBy: { createdAt: "asc" },
            select: { id: true, status: true, person: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    },
  })
  if (!service) notFound()
  const used = new Set(service.slots.map((s) => s.roleId))
  const addable = (await prisma.rosterRole.findMany({
    where: { archivedAt: null, id: { notIn: Array.from(used) } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, defaultCount: true },
  }))

  return (
    <div className="space-y-4">
      <p className="text-sm"><Link href="/roster" className="text-muted-foreground underline hover:text-foreground">← Roster</Link></p>
      <div>
        <h2 className="text-2xl font-semibold text-foreground">{service.title}</h2>
        <p className="text-sm text-muted-foreground">
          {formatSydneyDate(service.startsAt)}, {formatSydneyTime(service.startsAt)} to {formatSydneyTime(service.endsAt)}
          {service.location ? ` · ${service.location}` : ""}
        </p>
      </div>

      {service.slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roles added to this service yet.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {service.slots.map((sl) => (
            <SlotCard key={sl.id} slot={sl} />
          ))}
        </div>
      )}

      <AddSlotForm serviceId={service.id} roles={addable} />
    </div>
  )
}
