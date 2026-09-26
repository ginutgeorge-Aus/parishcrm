import { safeDecrypt } from "@/lib/crypto"
import { safeDobDate } from "@/lib/formatting"

// The subset of Person's encrypted-at-rest fields the detail page decrypts
// for display. Kept as a narrow local type (rather than importing the Prisma
// model) so this stays a plain, easily-testable function.
type PersonPIIFields = {
  email: string | null
  dateOfBirth: string | null
  mobile: string | null
  workPhone: string | null
  homePhone: string | null
  notes: string | null
  pastoralNotes: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
}

// Decrypt a person's PII for display. Pastoral/emergency-contact fields are
// only decrypted when `showPastoralNotes` is true — decrypt after the
// role gate, not before it (data-model "gate all reads").
export function buildDisplayPerson<T extends PersonPIIFields>(
  person: T,
  showPastoralNotes: boolean
): Omit<T, "dateOfBirth"> & { dateOfBirth: Date | null } {
  return {
    ...person,
    email: person.email ? safeDecrypt(person.email) : null,
    dateOfBirth: person.dateOfBirth ? safeDobDate(safeDecrypt(person.dateOfBirth)) : null,
    mobile: person.mobile ? safeDecrypt(person.mobile) : null,
    workPhone: person.workPhone ? safeDecrypt(person.workPhone) : null,
    homePhone: person.homePhone ? safeDecrypt(person.homePhone) : null,
    notes: person.notes ? safeDecrypt(person.notes) : null,
    pastoralNotes: showPastoralNotes && person.pastoralNotes ? safeDecrypt(person.pastoralNotes) : null,
    emergencyContactName:
      showPastoralNotes && person.emergencyContactName ? safeDecrypt(person.emergencyContactName) : null,
    emergencyContactPhone:
      showPastoralNotes && person.emergencyContactPhone ? safeDecrypt(person.emergencyContactPhone) : null,
  }
}

// Bucket transactions by the UTC calendar year of their `date`. Uses the UTC
// getter so negative-UTC-offset servers don't shift the bucket back a year
// (see src/lib/reports/plHelpers.ts for the same anchoring convention).
export function groupTransactionsByYear<T extends { date: Date }>(
  transactions: T[]
): Record<number, T[]> {
  return transactions.reduce<Record<number, T[]>>((acc, t) => {
    const year = t.date.getUTCFullYear()
    if (!acc[year]) acc[year] = []
    acc[year].push(t)
    return acc
  }, {})
}
