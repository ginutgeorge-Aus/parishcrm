import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { canAccessAccounting } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { getCustomerForEdit } from "@/lib/actions/customer"
import CustomerForm from "@/components/accounting/CustomerForm"

/** Edit a saved customer. Existing invoices keep their recipient snapshot. */
export default async function EditCustomerPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const params = await props.params
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/customers")
  const id = parseRouteId(params.id)
  if (id === null) notFound()
  const customer = await getCustomerForEdit(id)
  if (!customer) notFound()
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-foreground">Edit customer</h2>
      <CustomerForm edit={customer} />
    </div>
  )
}
