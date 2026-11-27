import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireOrganiserUserId, ledRoleWhere } from "@/lib/organiserSession"
import { sydneyToday } from "@/lib/dates"
import { ServiceWhen } from "@/components/organiser/ServiceWhen"
import { openPlaces } from "@/lib/roster"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

/** Most services listed at once: a defensive cap, the list is a rolling window. */
const MAX_SERVICES = 100

/**
 * Upcoming services that have a slot for a roster role in a live group this
 * login leads (GroupLeaderAccess). Only those slots are shown. The role check
 * is load-bearing: link rows survive a role change, so only an EVENT_ORGANISER
 * gets in (same rule as canEditRosterRole). Staff use /roster.
 */
export default async function MyRosterPage() {
  const userId = await requireOrganiserUserId()

  const led = ledRoleWhere(userId)
  const services = await prisma.rosterService.findMany({
    where: { date: { gte: sydneyToday() }, slots: { some: { role: led } } },
    orderBy: { startsAt: "asc" },
    take: MAX_SERVICES,
    select: {
      id: true, title: true, startsAt: true, endsAt: true, location: true,
      slots: {
        where: { role: led },
        orderBy: { role: { name: "asc" } },
        select: { id: true, needed: true, role: { select: { name: true } }, assignments: { select: { status: true } } },
      },
    },
  })

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-foreground">My Roster</h1>
      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No upcoming services need people for the roles you lead.
        </p>
      ) : (
        <ul className="space-y-3">
          {services.map((s) => (
            <li key={s.id}>
              <Link href={`/my-roster/${s.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="space-y-2">
                    <div>
                      <p className="font-medium text-foreground">{s.title}</p>
                      <ServiceWhen startsAt={s.startsAt} endsAt={s.endsAt} location={s.location} />
                    </div>
                    <ul className="flex flex-wrap gap-1.5">
                      {s.slots.map((sl) => {
                        const open = openPlaces(sl.needed, sl.assignments.map((a) => a.status))
                        return (
                          <li key={sl.id}>
                            <Badge variant={open === 0 ? "secondary" : "outline"}>
                              {sl.role.name}: {sl.needed - open}/{sl.needed}
                            </Badge>
                          </li>
                        )
                      })}
                    </ul>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
