import Link from "next/link"
import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { FamilyRole, Classification } from "@/lib/generated/prisma/enums"
import { CLASSIFICATION_LABELS, FAMILY_ROLE_LABELS } from "@/lib/personLabels"
import { APP_LOCALE } from "@/lib/appConfig"

// Intentionally local and distinct from PeopleList's Person: the card needs
// `dateOfBirth` but not `family`, while the list row is the inverse. They
// diverge by design — don't merge into one shared shape.
type Person = {
  id: number
  firstName: string
  lastName: string
  role: FamilyRole
  classification: Classification
  dateOfBirth: Date | null
  email: string | null
  mobile: string | null
}

export function PersonCard({ person }: { person: Person }) {
  const dob = person.dateOfBirth
    ? person.dateOfBirth.toLocaleDateString(APP_LOCALE)
    : "—"

  return (
    <TableRow>
      <TableCell className="font-medium">
        {person.firstName} {person.lastName}
      </TableCell>
      <TableCell>{FAMILY_ROLE_LABELS[person.role]}</TableCell>
      <TableCell>{CLASSIFICATION_LABELS[person.classification]}</TableCell>
      <TableCell>{dob}</TableCell>
      <TableCell>{person.email ?? "—"}</TableCell>
      <TableCell>{person.mobile ?? "—"}</TableCell>
      <TableCell className="print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/people/${person.id}`}>View</Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}
