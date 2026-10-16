import Link from "next/link"
import { Users } from "lucide-react"
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
import { Classification, FamilyRole } from "@/lib/generated/prisma/enums"
import { CLASSIFICATION_BADGE, CLASSIFICATION_LABELS, FAMILY_ROLE_LABELS } from "@/lib/personLabels"
import { EmptyState, type EmptyStateAction } from "@/components/shared/EmptyState"

// Intentionally local and distinct from PersonCard's Person: the list row needs
// `family` (for the link) but not `dateOfBirth`, while the card is the inverse.
// They diverge by design — don't merge into one shared shape.
type Person = {
  id: number
  firstName: string
  lastName: string
  role: FamilyRole
  classification: Classification
  email: string | null
  mobile: string | null
  family: { id: number; name: string }
}

/**
 * People directory: stacked cards on mobile, a table from `md` up. With no
 * rows it shows an empty state — "no matches" (Clear filters) when a filter
 * is active, otherwise "no people yet" with the add/import actions the viewer
 * is allowed to use.
 */
export function PeopleList({
  people,
  isFiltered = false,
  canAdd = false,
  canImport = false,
}: Readonly<{
  people: Person[]
  /** A search/filter is applied, so an empty list means "no matches". */
  isFiltered?: boolean
  /** Viewer may add people (canEdit). */
  canAdd?: boolean
  /** Viewer may bulk-import families/people from CSV (ADMIN). */
  canImport?: boolean
}>) {
  if (people.length === 0) {
    if (isFiltered) {
      return (
        <EmptyState
          icon={Users}
          title="No people match your filters"
          description="Try a different name or clear the filters to see everyone."
          actions={[{ label: "Clear filters", href: "/people", variant: "outline" }]}
        />
      )
    }
    const actions: EmptyStateAction[] = []
    if (canAdd) actions.push({ label: "Add person", href: "/people/new" })
    if (canImport) actions.push({ label: "Import CSV", href: "/import" })
    return (
      <EmptyState
        icon={Users}
        title="No people yet"
        description="Everyone in your church directory will show up here."
        actions={actions}
      />
    )
  }

  return (
    <>
      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {people.map((p) => (
          <li key={p.id}>
            <Link
              href={`/people/${p.id}`}
              className="block rounded-lg border bg-card p-4 active:bg-muted"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">
                  {p.firstName} {p.lastName}
                </span>
                <Badge {...CLASSIFICATION_BADGE[p.classification]}>{CLASSIFICATION_LABELS[p.classification]}</Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {p.family.name} · {FAMILY_ROLE_LABELS[p.role]}
              </div>
              {(p.email || p.mobile) && (
                <div className="mt-2 space-y-0.5 text-sm">
                  {p.email && <div className="break-all">{p.email}</div>}
                  {p.mobile && <div>{p.mobile}</div>}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
      <Table aria-label="People">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Family</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Classification</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Mobile</TableHead>
            <TableHead className="w-20 print:hidden"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">
                {p.firstName} {p.lastName}
              </TableCell>
              <TableCell>
                <Link href={`/families/${p.family.id}`} className="hover:underline text-sm">
                  {p.family.name}
                </Link>
              </TableCell>
              <TableCell>{FAMILY_ROLE_LABELS[p.role]}</TableCell>
              <TableCell>
                <Badge {...CLASSIFICATION_BADGE[p.classification]}>{CLASSIFICATION_LABELS[p.classification]}</Badge>
              </TableCell>
              <TableCell className="text-sm">{p.email ?? "—"}</TableCell>
              <TableCell className="text-sm">{p.mobile ?? "—"}</TableCell>
              <TableCell className="print:hidden">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/people/${p.id}`}>View</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </>
  )
}
