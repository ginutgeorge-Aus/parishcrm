import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@/lib/generated/prisma/enums"
import { formatSydneyDate, formatSydneyTime } from "@/lib/dates"
import { openPlaces } from "@/lib/roster"
import { parseRouteId } from "@/lib/validation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SlotCell } from "@/components/roster/SlotCell"

type Props = { params: Promise<{ id: string }> }

/**
 * One service as a group leader sees it: only the slots for roles in live
 * groups they lead (GroupLeaderAccess), with assign/remove. A service with none
 * of their roles is a 404, so the page never reveals other groups' rosters. The
 * assign and remove actions re-check the same access (canEditRosterRole).
 */
export default async function MyRosterServicePage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== UserRole.EVENT_ORGANISER) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  const userId = actorId(session)

  const service = await prisma.rosterService.findUnique({
    where: { id },
    select: {
      id: true, title: true, startsAt: true, endsAt: true, location: true,
      slots: {
        where: { role: { archivedAt: null, group: { archivedAt: null, leaderAccess: { some: { userId } } } } },
        orderBy: { role: { name: "asc" } },
        select: {
          id: true, needed: true,
          role: { select: { name: true } },
          assignments: {
            orderBy: { createdAt: "asc" },
            select: { id: true, status: true, person: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    },
  })
  if (!service || service.slots.length === 0) notFound()

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm"><Link href="/my-roster" className="text-muted-foreground underline hover:text-foreground">← My Roster</Link></p>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{service.title}</h1>
        <p className="text-sm text-muted-foreground">
          {formatSydneyDate(service.startsAt)}, {formatSydneyTime(service.startsAt)} to {formatSydneyTime(service.endsAt)}
          {service.location ? ` · ${service.location}` : ""}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {service.slots.map((sl) => {
          const open = openPlaces(sl.needed, sl.assignments.map((a) => a.status))
          return (
            <Card key={sl.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {sl.role.name} <span className="font-normal text-muted-foreground">({sl.needed - open}/{sl.needed})</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SlotCell
                  slotId={sl.id}
                  open={open}
                  canRemoveDeclined={false}
                  assignments={sl.assignments.map((a) => ({ id: a.id, name: `${a.person.firstName} ${a.person.lastName}`, status: a.status }))}
                />
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
