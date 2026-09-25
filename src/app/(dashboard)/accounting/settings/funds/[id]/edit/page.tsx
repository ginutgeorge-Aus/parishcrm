import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { updateFund } from "@/lib/actions/fund"
import { FundForm } from "@/components/accounting/FundForm"

export default async function EditFundPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/settings/funds")

  const id = parseInt(params.id, 10)
  if (isNaN(id) || id <= 0 || id > 2147483647) notFound()

  const fund = await prisma.fund.findUnique({ where: { id } })
  if (!fund) notFound()

  const action = updateFund.bind(null, fund.id)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Edit fund</h2>
      <FundForm action={action} fund={fund} />
    </div>
  )
}
