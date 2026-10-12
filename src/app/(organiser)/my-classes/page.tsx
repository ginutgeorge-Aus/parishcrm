import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"

/** The Sunday School classes this login is assigned to take the roll for. */
export default async function MyClassesPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const links = await prisma.sundaySchoolRollMarker.findMany({
    where: { userId: actorId(session), class: { archivedAt: null } },
    select: { class: { select: { id: true, name: true, year: true, location: true } } },
    orderBy: { class: { name: "asc" } },
  })
  const classes = links.map((l) => l.class)

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">My Classes</h1>
      {classes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No classes assigned to you yet. An administrator will add you to the classes you teach.
        </p>
      ) : (
        <ul className="space-y-3">
          {classes.map((c) => (
            <li key={c.id}>
              <Link
                href={`/my-classes/${c.id}/roll`}
                className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors duration-200 hover:bg-accent"
              >
                <div>
                  <p className="font-medium text-foreground">{c.name}</p>
                  <p className="text-sm text-muted-foreground">{[c.location, String(c.year)].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="text-sm text-muted-foreground">Take roll →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canEdit(session.user.role) && (
        <p className="mt-6 text-xs text-muted-foreground">
          You are viewing this as an editor. Volunteers see only classes assigned to them.
        </p>
      )}
    </div>
  )
}
