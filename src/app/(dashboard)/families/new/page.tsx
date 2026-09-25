import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { canEdit } from "@/lib/roleGuard"
import { createFamily } from "@/lib/actions/family"
import { FamilyForm } from "@/components/families/FamilyForm"
import { getMembershipSettings } from "@/lib/membershipSettings"

export default async function NewFamilyPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!canEdit(session.user.role)) redirect("/families")
  const { minDues } = await getMembershipSettings()

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-1">
        <Link href="/families" className="hover:underline">Families</Link>
        {" / New family"}
      </p>
      <h2 className="text-2xl font-semibold text-foreground mb-6">New family</h2>
      <FamilyForm action={createFamily} defaultDues={minDues} />
    </div>
  )
}
