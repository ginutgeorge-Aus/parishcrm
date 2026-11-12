import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit, isAdmin, canViewPeople } from "@/lib/roleGuard"
import { FamilyList } from "@/components/families/FamilyList"
import { FamilyFilters } from "@/components/families/FamilyFilters"
import { Button } from "@/components/ui/button"
import { safeDecrypt } from "@/lib/crypto"
import { FamilyStatus } from "@/lib/generated/prisma/enums"
import type { Prisma } from "@/lib/generated/prisma/client"
import { FAMILY_CAP, LEGACY_SUBURB_SCAN_CAP, findFamiliesBySuburb } from "@/lib/familySuburbFilter"

export default async function FamiliesPage(
  props: Readonly<{ searchParams: Promise<{ q?: string; status?: string; suburb?: string }> }>
) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!canViewPeople(session?.user?.role)) redirect("/") // AUDITOR is accounting-only
  const userIsAdmin = isAdmin(session?.user?.role)
  const userCanEdit = canEdit(session?.user?.role)

  const q = searchParams.q?.trim() ?? ""
  const statusFilter = Object.values(FamilyStatus).includes(searchParams.status as FamilyStatus)
    ? (searchParams.status as FamilyStatus)
    : null
  const suburbFilter = searchParams.suburb?.trim() ?? ""

  const baseWhere: Prisma.FamilyWhereInput = {
    archivedAt: null,
    ...(q && { name: { contains: q, mode: "insensitive" } }),
    ...(statusFilter && { status: statusFilter }),
  }
  /**
   * Load families for the list, ordered by name.
   *
   * @param where - Prisma filter (base filters, plus the suburb hash/legacy clause when searching)
   * @param take - row cap for this query
   * @returns families with the list columns; `suburb` is still encrypted
   */
  const fetchFamilies = (where: Prisma.FamilyWhereInput, take: number) =>
    prisma.family.findMany({
      where,
      take,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        memberNo: true,
        suburb: true,
        status: true,
        _count: { select: { people: { where: { archivedAt: null } } } },
      },
    })

  // suburb is encrypted: match it through the suburbHash blind index (OSS-39),
  // see lib/familySuburbFilter.ts. Neither branch is ever unbounded.
  let visibleFamilies: Awaited<ReturnType<typeof fetchFamilies>>
  let suburbCapped = false
  let scanIncomplete = false
  if (suburbFilter) {
    const result = await findFamiliesBySuburb(fetchFamilies, baseWhere, suburbFilter)
    visibleFamilies = result.families
    suburbCapped = result.capped
    scanIncomplete = result.scanIncomplete
  } else {
    const families = await fetchFamilies(baseWhere, FAMILY_CAP)
    visibleFamilies = families.map((f) => ({ ...f, suburb: f.suburb ? safeDecrypt(f.suburb) : null }))
  }
  const totalCount = await prisma.family.count({ where: baseWhere })

  const isFiltered = Boolean(q || statusFilter || suburbFilter)
  // Empty directory: the list's empty state carries Add family / Import CSV,
  // so the toolbar doesn't offer them a second time.
  const noFamiliesYet = totalCount === 0 && !isFiltered

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">Families</h2>
        <div className="flex flex-wrap items-center gap-2">
          {userIsAdmin && (
            <Link href="/families/archived" className="text-sm text-muted-foreground underline hover:text-foreground">
              View archived
            </Link>
          )}
          {userIsAdmin && (
            <Link href="/families/merge" className="text-sm text-muted-foreground underline hover:text-foreground">
              Merge duplicates
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Suspense>
          <FamilyFilters />
        </Suspense>
        {userCanEdit && !noFamiliesYet && (
          <Button asChild>
            <Link href="/families/new">New family</Link>
          </Button>
        )}
        {userIsAdmin && !noFamiliesYet && (
          <Button variant="outline" asChild>
            <Link href="/import">Import CSV</Link>
          </Button>
        )}
        {userIsAdmin && (
          <Button variant="outline" asChild>
            <Link href="/families/directory/print" target="_blank" rel="noopener noreferrer">Print Directory</Link>
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {visibleFamilies.length} of {totalCount.toLocaleString()} families
        {suburbFilter ? ` matching suburb "${suburbFilter}"` : ""}
      </p>

      {suburbFilter && (suburbCapped || scanIncomplete) && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/40 rounded px-3 py-2">
          {scanIncomplete
            ? `Suburb results may be incomplete: more than ${LEGACY_SUBURB_SCAN_CAP} families are not yet in the suburb search index, so only the first ${LEGACY_SUBURB_SCAN_CAP} of them were searched. An administrator can run the suburb index backfill, or narrow other filters.`
            : `Showing first ${FAMILY_CAP} suburb matches. Narrow other filters to reduce results.`}
        </p>
      )}
      {!suburbFilter && totalCount > FAMILY_CAP && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/40 rounded px-3 py-2">
          Showing {FAMILY_CAP} of {totalCount.toLocaleString()} families. Use filters to narrow results.
        </p>
      )}

      <FamilyList
        families={visibleFamilies}
        canEdit={userCanEdit}
        isFiltered={isFiltered}
        canImport={userIsAdmin}
        scanIncomplete={scanIncomplete}
        suburbFiltered={Boolean(suburbFilter)}
      />
    </div>
  )
}
