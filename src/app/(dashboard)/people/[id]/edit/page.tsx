import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit, canSeePastoralNotes } from "@/lib/roleGuard"
import { updatePerson } from "@/lib/actions/person"
import { PersonForm } from "@/components/people/PersonForm"
import { safeDecrypt } from "@/lib/crypto"
import { parseRouteId } from "@/lib/validation"

export default async function EditPersonPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!canEdit(session?.user?.role)) redirect("/families")

  const id = parseRouteId(params.id)
  if (id === null) notFound()

  const person = await prisma.person.findUnique({ where: { id } })
  // Archived persons are hidden everywhere and only ever archived via their
  // family; block direct-URL edit so archived PII can't be loaded/overwritten.
  if (!person || person.archivedAt) notFound()

  const action = updatePerson.bind(null, person.id, person.familyId)
  // Only decrypt pastoral notes / emergency contact for roles allowed to see them.
  // Client-side hiding in PersonForm is insufficient — plaintext in the RSC payload
  // still reaches the browser for OFFICE_ADMIN (canEdit but not canSeePastoralNotes).
  const showPastoralNotes = canSeePastoralNotes(session?.user?.role)
  const displayPerson = {
    ...person,
    email: person.email ? safeDecrypt(person.email) : null,
    dateOfBirth: person.dateOfBirth ? safeDecrypt(person.dateOfBirth) : null,
    mobile: person.mobile ? safeDecrypt(person.mobile) : null,
    workPhone: person.workPhone ? safeDecrypt(person.workPhone) : null,
    homePhone: person.homePhone ? safeDecrypt(person.homePhone) : null,
    notes: person.notes ? safeDecrypt(person.notes) : null,
    pastoralNotes: showPastoralNotes && person.pastoralNotes ? safeDecrypt(person.pastoralNotes) : null,
    emergencyContactName: showPastoralNotes && person.emergencyContactName ? safeDecrypt(person.emergencyContactName) : null,
    emergencyContactPhone: showPastoralNotes && person.emergencyContactPhone ? safeDecrypt(person.emergencyContactPhone) : null,
  }

  const fullName = [person.title, person.firstName, person.middleName, person.lastName, person.suffix]
    .filter(Boolean)
    .join(" ")

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-1">
        <Link href="/families" className="hover:underline">Families</Link>
        {" / "}
        <Link href={`/people/${person.id}`} className="hover:underline">{fullName}</Link>
        {" / Edit"}
      </p>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Edit person</h2>
      <PersonForm
        action={action}
        person={displayPerson}
        canSeePastoralNotes={showPastoralNotes}
      />
    </div>
  )
}
