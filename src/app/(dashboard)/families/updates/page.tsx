import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

export default async function FamilyUpdatesInbox() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!canEdit(session.user.role)) redirect("/families")

  const [subs, totalPending] = await Promise.all([
    prisma.familyUpdateSubmission.findMany({
      where: { status: "PENDING", family: { archivedAt: null } },
      include: { family: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.familyUpdateSubmission.count({ where: { status: "PENDING", family: { archivedAt: null } } }),
  ])

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold mb-4">Family update requests</h2>
      {totalPending > 200 && (
        <p className="text-sm text-warning mb-2">Showing first 200 of {totalPending} pending submissions.</p>
      )}
      {subs.length === 0 ? (
        <p className="text-muted-foreground">No pending submissions.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {subs.map((s) => (
            <li key={s.id} className="px-4 py-3 flex items-center justify-between">
              <span>
                {s.family.name}{" "}
                <span className="text-muted-foreground text-sm">· submitted {s.createdAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })}</span>
              </span>
              <Link href={`/families/updates/${s.id}`} className="text-success underline text-sm font-medium">Review</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}