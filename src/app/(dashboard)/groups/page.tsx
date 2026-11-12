import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageGroups, canViewGroups } from "@/lib/roleGuard"
import { GROUP_CATEGORIES, GROUP_CATEGORY_LABELS, parseCategoryFilter } from "@/lib/groups"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Props = { searchParams: Promise<{ category?: string; archived?: string }> }

/** Build a /groups URL for a category filter + archived toggle. */
function href(category: string | null, archived: boolean): string {
  const p = new URLSearchParams()
  if (category) p.set("category", category)
  if (archived) p.set("archived", "1")
  const q = p.toString()
  return q ? `/groups?${q}` : "/groups"
}

/** Groups & ministries list with a category filter and member counts. canViewGroups to view; managers create. */
export default async function GroupsPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canViewGroups(session.user.role)) redirect("/")
  const sp = await props.searchParams
  const category = parseCategoryFilter(sp.category)
  const archived = sp.archived === "1"
  const manager = canManageGroups(session.user.role)

  const groups = await prisma.group.findMany({
    where: { archivedAt: archived ? { not: null } : null, ...(category ? { category } : {}) },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, category: true, description: true,
      _count: { select: { members: { where: { person: { archivedAt: null } } } } },
    },
  })

  const chip = (active: boolean) => cn(
    "inline-flex min-h-11 items-center rounded-full border px-3 text-sm sm:min-h-8",
    active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">{archived ? "Archived groups" : "Groups"}</h2>
        {manager && !archived && (
          <Button asChild><Link href="/groups/new">New group</Link></Button>
        )}
      </div>

      <nav aria-label="Filter by category" className="flex flex-wrap gap-2">
        <Link href={href(null, archived)} className={chip(category === null)} aria-current={category === null ? "page" : undefined}>All</Link>
        {GROUP_CATEGORIES.map((c) => (
          <Link key={c} href={href(c, archived)} className={chip(category === c)} aria-current={category === c ? "page" : undefined}>
            {GROUP_CATEGORY_LABELS[c]}
          </Link>
        ))}
      </nav>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {archived ? "No archived groups." : "No groups yet."}
          {manager && !archived && (
            <>
              {" "}
              <Link href="/groups/new" className="underline hover:text-foreground">Create the first group</Link>.
            </>
          )}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {groups.map((g) => {
            const n = g._count.members
            return (
              <Link key={g.id} href={`/groups/${g.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardContent className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate font-medium text-foreground">{g.name}</p>
                      <Badge variant="secondary">{GROUP_CATEGORY_LABELS[g.category]}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{n} {n === 1 ? "member" : "members"}</p>
                    {g.description && <p className="line-clamp-2 text-sm text-muted-foreground">{g.description}</p>}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <p className="text-sm">
        <Link href={href(category, !archived)} className="text-muted-foreground underline hover:text-foreground">
          {archived ? "← Back to active groups" : "Show archived groups"}
        </Link>
      </p>
    </div>
  )
}
