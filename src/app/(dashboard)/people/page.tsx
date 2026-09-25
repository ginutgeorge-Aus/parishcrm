import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit, canViewPeople, isAdmin } from "@/lib/roleGuard"
import { PeopleList } from "@/components/people/PeopleList"
import { PeopleFilters } from "@/components/people/PeopleFilters"
import { Button } from "@/components/ui/button"
import { safeDecrypt } from "@/lib/crypto"
import { Classification, FamilyRole } from "@/lib/generated/prisma/enums"

const PEOPLE_CAP = 500
const MAX_QUERY_LENGTH = 100

export default async function PeoplePage(
  props: { searchParams: Promise<{ q?: string; classification?: string; role?: string }> }
) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!canViewPeople(session?.user?.role)) redirect("/") // AUDITOR is accounting-only
  const userCanEdit = canEdit(session?.user?.role)
  const userIsAdmin = isAdmin(session?.user?.role) // bulk PII export is ADMIN-only

  const q = (searchParams.q?.trim() ?? "").slice(0, MAX_QUERY_LENGTH)
  const classificationFilter = Object.values(Classification).includes(searchParams.classification as Classification)
    ? (searchParams.classification as Classification)
    : null
  const roleFilter = Object.values(FamilyRole).includes(searchParams.role as FamilyRole)
    ? (searchParams.role as FamilyRole)
    : null

  // Shared filter for both the page query and the total count — kept as one
  // object so the two can never drift out of sync.
  const peopleWhere = {
    archivedAt: null,
    ...(q && {
      OR: [
        { firstName: { contains: q, mode: "insensitive" as const } },
        { lastName: { contains: q, mode: "insensitive" as const } },
      ],
    }),
    ...(classificationFilter && { classification: classificationFilter }),
    ...(roleFilter && { role: roleFilter }),
  }

  const [people, totalCount] = await Promise.all([
    prisma.person.findMany({
      where: peopleWhere,
      take: PEOPLE_CAP,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        classification: true,
        email: true,
        mobile: true,
        family: { select: { id: true, name: true } },
      },
    }),
    prisma.person.count({ where: peopleWhere }),
  ])

  const decrypted = people.map((p) => ({
    ...p,
    email: p.email ? safeDecrypt(p.email) : null,
    mobile: p.mobile ? safeDecrypt(p.mobile) : null,
  }))

  const exportParams = new URLSearchParams()
  if (q) exportParams.set("q", q)
  if (classificationFilter) exportParams.set("classification", classificationFilter)
  if (roleFilter) exportParams.set("role", roleFilter)
  const exportUrl = `/api/people/export?${exportParams.toString()}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-foreground">People</h2>
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Suspense>
          <PeopleFilters />
        </Suspense>
        {userIsAdmin && (
          <Button variant="outline" size="sm" asChild>
            <a href={exportUrl} download>Export CSV</a>
          </Button>
        )}
        {userCanEdit && (
          <Button size="sm" asChild>
            <Link href="/people/new">New person</Link>
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {decrypted.length} of {totalCount.toLocaleString()} people
      </p>

      {totalCount > PEOPLE_CAP && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/40 rounded px-3 py-2">
          Showing {PEOPLE_CAP} of {totalCount.toLocaleString()} people. Use filters to narrow results.
        </p>
      )}

      <PeopleList people={decrypted} />
    </div>
  )
}
