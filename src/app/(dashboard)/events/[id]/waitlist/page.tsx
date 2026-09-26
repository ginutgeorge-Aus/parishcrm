import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { canEdit, canViewPeople } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { formatSydneyDate } from "@/lib/dates"
import Link from "next/link"
import { WaitlistNotifyToggle } from "@/components/events/WaitlistNotifyToggle"
import { parseRouteId } from "@/lib/validation"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Props = { params: Promise<{ id: string }> }

export default async function WaitlistPage(props: Props) {
  const params = await props.params
  const session = await auth()
  if (!session) redirect("/login")
  if (!canViewPeople(session.user.role)) redirect("/")

  const eventId = parseRouteId(params.id)
  if (eventId === null) notFound()

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      waitlist: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          notifiedAt: true,
          createdAt: true,
          ticketType: { select: { name: true } },
        },
      },
    },
  })
  if (!event) notFound()

  const editable = canEdit(session.user.role)
  const rows = event.waitlist.map(w => ({
    id: w.id,
    name: w.name,
    email: safeDecrypt(w.email),
    ticketName: w.ticketType.name,
    notifiedAt: w.notifiedAt,
    createdAt: w.createdAt,
  }))

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href={`/events/${eventId}/registrations`}
          className="text-xs text-muted-foreground hover:text-foreground mb-1 inline-block"
        >
          ← Registrations
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{event.title} — Waitlist</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {rows.length} {rows.length === 1 ? "person" : "people"} on waitlist
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No one on the waitlist yet.</p>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <Table className="min-w-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Notified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground">{row.ticketName}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatSydneyDate(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <WaitlistNotifyToggle
                        id={row.id}
                        eventId={eventId}
                        notified={row.notifiedAt !== null}
                        canEdit={editable}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="space-y-2 md:hidden">
            {rows.map(row => (
              <li key={row.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{row.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.ticketName}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                    {formatSydneyDate(row.createdAt)}
                  </span>
                </div>
                <p className="mt-2 truncate text-xs text-muted-foreground">{row.email}</p>
                <div className="mt-2 flex items-center justify-between border-t pt-2">
                  <span className="text-xs text-muted-foreground">Notified</span>
                  <WaitlistNotifyToggle
                    id={row.id}
                    eventId={eventId}
                    notified={row.notifiedAt !== null}
                    canEdit={editable}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
