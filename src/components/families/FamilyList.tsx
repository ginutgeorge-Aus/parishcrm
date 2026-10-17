import Link from "next/link"
import { House } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FamilyStatus } from "@/lib/generated/prisma/enums"
import { FAMILY_STATUS_LABELS } from "@/lib/familyLabels"
import { EmptyState, type EmptyStateAction } from "@/components/shared/EmptyState"

type Family = {
  id: number
  name: string
  memberNo: string | null
  suburb: string | null
  status: FamilyStatus
  _count: { people: number }
}

const statusVariant: Record<FamilyStatus, "default" | "secondary" | "outline"> = {
  ACTIVE: "default",
  INACTIVE: "secondary",
  VISITOR: "outline",
}

/**
 * Family directory: stacked cards on mobile, a table from `md` up. With no
 * rows it shows an empty state — "no matches" (Clear filters) when a filter
 * is active, otherwise "no families yet" with the add/import actions the
 * viewer is allowed to use.
 */
export function FamilyList({
  families,
  canEdit,
  isFiltered = false,
  canImport = false,
  scanIncomplete = false,
}: Readonly<{
  families: Family[]
  canEdit: boolean
  /** A search/filter is applied, so an empty list means "no matches". */
  isFiltered?: boolean
  /** Viewer may bulk-import families from CSV (ADMIN). */
  canImport?: boolean
  /** The suburb scan hit its candidate cap, so an empty result may be incomplete. */
  scanIncomplete?: boolean
}>) {
  if (families.length === 0) {
    if (isFiltered && scanIncomplete) {
      return (
        <EmptyState
          icon={House}
          title="No matches found in the first families searched"
          description="The suburb search only covers part of the directory. Narrow the name or status filters, or clear the filters."
          actions={[{ label: "Clear filters", href: "/families", variant: "outline" }]}
        />
      )
    }
    if (isFiltered) {
      return (
        <EmptyState
          icon={House}
          title="No families match your filters"
          description="Try a different name, status or suburb, or clear the filters."
          actions={[{ label: "Clear filters", href: "/families", variant: "outline" }]}
        />
      )
    }
    const actions: EmptyStateAction[] = []
    if (canEdit) actions.push({ label: "Add family", href: "/families/new" })
    if (canImport) actions.push({ label: "Import CSV", href: "/import" })
    return (
      <EmptyState
        icon={House}
        title="No families yet"
        description={
          actions.length > 0
            ? "Add your first family by hand, or import your existing list from a spreadsheet."
            : "Families will appear here once an editor adds them."
        }
        actions={actions}
      />
    )
  }

  return (
    <>
      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {families.map((f) => (
          <li key={f.id}>
            <Link
              href={`/families/${f.id}`}
              className="block rounded-lg border bg-card p-4 active:bg-muted"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{f.name}</span>
                <Badge variant={statusVariant[f.status]}>{FAMILY_STATUS_LABELS[f.status]}</Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {f.memberNo ?? "—"}
                {f.suburb ? ` · ${f.suburb}` : ""} · {f._count.people}{" "}
                {f._count.people === 1 ? "member" : "members"}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
      <Table aria-label="Families">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Member No</TableHead>
            <TableHead>Suburb</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Members</TableHead>
            <TableHead className="w-24 print:hidden"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {families.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="font-medium">{f.name}</TableCell>
              <TableCell>{f.memberNo ?? "—"}</TableCell>
              <TableCell>{f.suburb ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={statusVariant[f.status]}>{FAMILY_STATUS_LABELS[f.status]}</Badge>
              </TableCell>
              <TableCell>{f._count.people}</TableCell>
              <TableCell className="print:hidden">
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/families/${f.id}`}>View</Link>
                  </Button>
                  {canEdit && (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/families/${f.id}/edit`}>Edit</Link>
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </>
  )
}
