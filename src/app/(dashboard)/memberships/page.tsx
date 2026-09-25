import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { MEMBERSHIP_STATUS_LABELS } from "@/lib/membershipLabels"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

const STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const
type Status = (typeof STATUSES)[number]

export default async function MembershipsInbox({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!canEdit(session.user.role)) redirect("/")

  const { status } = await searchParams
  const active: Status = STATUSES.includes(status as Status) ? (status as Status) : "PENDING"

  const [apps, totalPending] = await Promise.all([
    prisma.membershipApplication.findMany({
      where: { status: active },
      select: { id: true, applicantName: true, createdAt: true, status: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.membershipApplication.count({ where: { status: "PENDING" } }),
  ])

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold mb-4">Membership applications</h2>

      <div className="mb-4 flex gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/memberships?status=${s}`}
            className={`inline-flex items-center rounded-md border px-3 py-2 min-h-11 min-w-11 ${s === active ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {MEMBERSHIP_STATUS_LABELS[s]}
            {s === "PENDING" && totalPending > 0 ? ` (${totalPending})` : ""}
          </Link>
        ))}
      </div>

      {apps.length === 0 ? (
        <p className="text-muted-foreground">No {MEMBERSHIP_STATUS_LABELS[active].toLowerCase()} applications.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {apps.map((a) => (
            <li key={a.id} className="px-4 py-3 flex items-center justify-between">
              <span>
                {a.applicantName}{" "}
                <span className="text-muted-foreground text-sm">· submitted {a.createdAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })}</span>
              </span>
              <Link href={`/memberships/${a.id}`} className="text-success underline text-sm font-medium">
                {active === "PENDING" ? "Review" : "View"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
