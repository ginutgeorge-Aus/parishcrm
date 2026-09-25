import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { updateFamily } from "@/lib/actions/family"
import { FamilyForm } from "@/components/families/FamilyForm"
import { safeDecrypt } from "@/lib/crypto"
import { toFloat } from "@/lib/utils"

export default async function EditFamilyPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session) redirect("/login")
  if (!canEdit(session.user.role)) redirect("/families")

  const id = parseInt(params.id, 10)
  if (isNaN(id) || id <= 0 || id > 2147483647) notFound()

  const family = await prisma.family.findUnique({ where: { id } })
  // Archived families are frozen — editing them via a direct URL would
  // bypass the archive/unarchive lifecycle and its atomic member handling.
  if (!family || family.archivedAt) notFound()

  const action = updateFamily.bind(null, family.id)
  const displayFamily = {
    ...family,
    address: family.address ? safeDecrypt(family.address) : null,
    suburb: family.suburb ? safeDecrypt(family.suburb) : null,
    state: family.state ? safeDecrypt(family.state) : null,
    postcode: family.postcode ? safeDecrypt(family.postcode) : null,
    homePhone: family.homePhone ? safeDecrypt(family.homePhone) : null,
    notes: family.notes ? safeDecrypt(family.notes) : null,
    monthlyDues: family.monthlyDues != null ? toFloat(family.monthlyDues) : null,
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-1">
        <Link href="/families" className="hover:underline">Families</Link>
        {" / "}
        <Link href={`/families/${family.id}`} className="hover:underline">{family.name}</Link>
        {" / Edit"}
      </p>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Edit family</h2>
      <FamilyForm action={action} family={displayFamily} />
    </div>
  )
}
