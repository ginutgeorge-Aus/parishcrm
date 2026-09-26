import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { unarchiveFamily } from "@/lib/actions/family"
import { Button } from "@/components/ui/button"
import { DeleteFamilyButton } from "@/components/families/DeleteFamilyButton"
import { retentionFloor } from "@/lib/retention"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

export default async function ArchivedFamiliesPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>
}) {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")

  const { page: rawPage } = (await searchParams) ?? {}
  const page = Math.max(1, Number.parseInt(rawPage || "1", 10) || 1)
  const pageSize = 50

  const families = await prisma.family.findMany({
    where: { archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      _count: { select: { people: true } },
    },
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  const total = await prisma.family.count({
    where: { archivedAt: { not: null } },
  })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Shared with deleteFamily's server-side gate so the "Delete" button
  // shown here is never eligible when the action would actually reject it.
  const floor = retentionFloor()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-foreground">Archived Families</h2>
        <Button asChild variant="outline" size="sm">
          <Link href="/families">Back to Families</Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Archived families are excluded from all lists and reports. Permanent deletion is
        available after 7 years (ATO record-keeping requirement).
      </p>
      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {families.length === 0 && (
          <li className="rounded-lg border bg-card py-12 text-center text-muted-foreground">
            No archived families.
          </li>
        )}
        {families.map((f) => {
          const canDelete = f.archivedAt
            ? f.archivedAt < floor
            : false
          return (
            <li key={f.id} className="rounded-lg border bg-card p-4">
              <div className="font-medium">{f.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {f._count.people} {f._count.people === 1 ? "member" : "members"}
                {f.archivedAt ? ` · archived ${f.archivedAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })}` : ""}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form
                  action={async () => {
                    "use server"
                    await unarchiveFamily(f.id)
                  }}
                >
                  <Button type="submit" variant="outline" size="sm" className="h-11 min-h-11 min-w-11">
                    Unarchive
                  </Button>
                </form>
                {canDelete ? (
                  <DeleteFamilyButton
                    familyId={f.id}
                    familyName={f.name}
                    triggerClassName="h-11 min-h-11 min-w-11"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Deletion locked — available 7 years after archive
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <Table className="min-w-table">
          <TableHeader>
            <TableRow>
              <TableHead>Family</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Archived</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {families.map((f) => {
              const canDelete = f.archivedAt
                ? f.archivedAt < floor
                : false
              return (
                <TableRow key={f.id}>
                  <TableCell>{f.name}</TableCell>
                  <TableCell>{f._count.people}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {f.archivedAt?.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })}
                  </TableCell>
                  <TableCell className="flex gap-2 items-center">
                    <form
                      action={async () => {
                        "use server"
                        await unarchiveFamily(f.id)
                      }}
                    >
                      <Button type="submit" variant="outline" size="sm">
                        Unarchive
                      </Button>
                    </form>
                    {canDelete ? (
                      <DeleteFamilyButton familyId={f.id} familyName={f.name} />
                    ) : (
                      <span className="text-xs text-muted-foreground" title="Available 7 years after archive">
                        Deletion locked
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {families.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No archived families.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/families/archived?page=${page - 1}`}>Previous</Link>
          </Button>
        ) : <div />}
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/families/archived?page=${page + 1}`}>Next</Link>
          </Button>
        ) : <div />}
      </div>
    </div>
  )
}
