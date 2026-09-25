import Link from "next/link"
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

export function PeopleList({ people }: { people: Person[] }) {
  return (
    <>
      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {people.length === 0 && (
          <li className="rounded-lg border bg-card py-12 text-center">
            <p className="font-medium">No people found</p>
            <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search, or add a new person.</p>
          </li>
        )}
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
      <Table>
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
          {people.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-12 text-center">
                <p className="font-medium">No people found</p>
                <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search, or add a new person.</p>
              </TableCell>
            </TableRow>
          )}
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
