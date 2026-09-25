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

const FAMILY_CAP = 500
// When the suburb filter is active we must decrypt rows in memory to match, so
// we can't push the filter to the DB — but we still bound the scan/decrypt loop
// so a broad name/status filter can't load tens of thousands of rows. The
// post-decrypt match + the existing amber "narrow your filters" warning operate
// within this window.
const SUBURB_SCAN_CAP = 2000

export default async function FamiliesPage(
  props: { searchParams: Promise<{ q?: string; status?: string; suburb?: string }> }
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

  // suburb is encrypted — filter in memory after decrypt when active
  const families = await prisma.family.findMany({
    where: {
      archivedAt: null,
      ...(q && { name: { contains: q, mode: "insensitive" } }),
      ...(statusFilter && { status: statusFilter }),
    },
    // Suburb filter runs in memory after decrypt, so use a higher scan cap; the
    // plain list caps at FAMILY_CAP. Neither branch is ever unbounded.
    take: suburbFilter ? SUBURB_SCAN_CAP : FAMILY_CAP,
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

  const decrypted = families.map((f) => ({
    ...f,
    suburb: f.suburb ? safeDecrypt(f.suburb) : null,
  }))

  const allFiltered = suburbFilter
    ? decrypted.filter((f) =>
        (f.suburb ?? "").toLowerCase().includes(suburbFilter.toLowerCase())
      )
    : decrypted

  const suburbCapped = suburbFilter && allFiltered.length > FAMILY_CAP
  const visibleFamilies = suburbCapped ? allFiltered.slice(0, FAMILY_CAP) : allFiltered
  const totalCount = await prisma.family.count({
    where: {
      archivedAt: null,
      ...(q && { name: { contains: q, mode: "insensitive" } }),
      ...(statusFilter && { status: statusFilter }),
    },
  })

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
        {userCanEdit && (
          <Button asChild>
            <Link href="/families/new">New family</Link>
          </Button>
        )}
        {userIsAdmin && (
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

      {suburbFilter && (suburbCapped || families.length >= SUBURB_SCAN_CAP) && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/40 rounded px-3 py-2">
          {families.length >= SUBURB_SCAN_CAP
            ? `Suburb results may be incomplete: only the first ${SUBURB_SCAN_CAP} candidate families were searched. Showing up to ${FAMILY_CAP} matches. Narrow other filters to reduce results.`
            : `Showing first ${FAMILY_CAP} suburb matches. Narrow other filters to reduce results.`}
        </p>
      )}
      {!suburbFilter && totalCount > FAMILY_CAP && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/40 rounded px-3 py-2">
          Showing {FAMILY_CAP} of {totalCount.toLocaleString()} families. Use filters to narrow results.
        </p>
      )}

      <FamilyList families={visibleFamilies} canEdit={userCanEdit} />
    </div>
  )
}
