import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit, canSeePastoralNotes } from "@/lib/roleGuard"
import { createPerson } from "@/lib/actions/person"
import { PersonForm } from "@/components/people/PersonForm"

export default async function NewPersonPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session) redirect("/login")
  if (!canEdit(session.user.role)) redirect("/families")

  const familyId = parseInt(params.id, 10)
  if (isNaN(familyId) || familyId <= 0 || familyId > 2147483647) notFound()

  const family = await prisma.family.findUnique({ where: { id: familyId }, select: { id: true, name: true, archivedAt: true } })
  // mirror the archived-family guard on edit/page.tsx, giving/page.tsx,
  // and [id]/page.tsx — without it, a canEdit role with no /families/archived
  // access (OFFICE_ADMIN) could still reach this URL directly and see the
  // archived family's real name in the breadcrumb/heading.
  if (!family || family.archivedAt) notFound()

  const action = createPerson.bind(null, familyId)

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-1">
        <Link href="/families" className="hover:underline">Families</Link>
        {" / "}
        <Link href={`/families/${family.id}`} className="hover:underline">{family.name}</Link>
        {" / Add member"}
      </p>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Add member</h2>
      <PersonForm action={action} canSeePastoralNotes={canSeePastoralNotes(session?.user?.role)} />
    </div>
  )
}
