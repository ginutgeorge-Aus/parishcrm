import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { createFund } from "@/lib/actions/fund"
import { FundForm } from "@/components/accounting/FundForm"

export default async function NewFundPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/settings/funds")

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">New fund</h2>
      <FundForm action={createFund} />
    </div>
  )
}
