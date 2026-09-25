import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FamilyRole, Classification } from "@/lib/generated/prisma/enums"
import { CLASSIFICATION_LABELS, FAMILY_ROLE_LABELS } from "@/lib/personLabels"
import { APP_LOCALE } from "@/lib/appConfig"

// Mirrors PersonCard's local Person shape — see its comment for why it's
// distinct from PeopleList's Person.
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

export function PersonMobileList({ people }: { people: Person[] }) {
  return (
    // Mobile: card per member (avoids sideways table scroll)
    <ul className="space-y-2 md:hidden">
      {people.length === 0 && (
        <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No members yet
        </li>
      )}
      {people.map((person) => {
        const dob = person.dateOfBirth
          ? person.dateOfBirth.toLocaleDateString(APP_LOCALE)
          : "—"
        return (
          <li key={person.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {person.firstName} {person.lastName}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {FAMILY_ROLE_LABELS[person.role]} · {CLASSIFICATION_LABELS[person.classification]} · {dob}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {person.email ?? "—"} · {person.mobile ?? "—"}
                </p>
              </div>
              <Button variant="ghost" size="sm" asChild className="print:hidden shrink-0">
                <Link href={`/people/${person.id}`}>View</Link>
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
