import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageRoster } from "@/lib/roleGuard"
import { formatSydneyDate, formatSydneyTime, sydneyToday } from "@/lib/dates"
import { openPlaces } from "@/lib/roster"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

type Props = { searchParams: Promise<{ past?: string }> }

/** Most services listed at once: a defensive cap, the list is a rolling window. */
const MAX_SERVICES = 100

/**
 * Staff roster: the services to staff (upcoming by default, past on request)
 * with, per role, how many places are filled. canManageRoster only; group
 * leaders use their own portal.
 */
export default async function RosterPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canManageRoster(session.user.role)) redirect("/")
  const past = (await props.searchParams).past === "1"
  const today = sydneyToday()

  const services = await prisma.rosterService.findMany({
    where: { date: past ? { lt: today } : { gte: today } },
    orderBy: { startsAt: past ? "desc" : "asc" },
    take: MAX_SERVICES,
    select: {
      id: true, title: true, date: true, startsAt: true, endsAt: true, location: true,
      slots: {
        orderBy: { role: { name: "asc" } },
        select: { id: true, needed: true, role: { select: { name: true } }, assignments: { select: { status: true } } },
      },
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">{past ? "Past services" : "Roster"}</h2>
      </div>

      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">{past ? "No past services." : "No upcoming services."}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {services.map((s) => (
            <Link key={s.id} href={`/roster/${s.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardContent className="space-y-2">
                  <div>
                    <p className="font-medium text-foreground">{s.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatSydneyDate(s.startsAt)}, {formatSydneyTime(s.startsAt)} to {formatSydneyTime(s.endsAt)}
                      {s.location ? ` · ${s.location}` : ""}
                    </p>
                  </div>
                  {s.slots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No roles added yet.</p>
                  ) : (
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
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-sm">
        <Link href={past ? "/roster" : "/roster?past=1"} className="text-muted-foreground underline hover:text-foreground">
          {past ? "← Back to upcoming services" : "Show past services"}
        </Link>
      </p>
    </div>
  )
}
