import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canAccessAccounting } from "@/lib/roleGuard"
import CustomerForm from "@/components/accounting/CustomerForm"

/** Create a saved outside customer. */
export default async function NewCustomerPage() {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/customers")
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-foreground">New customer</h2>
      <CustomerForm />
    </div>
  )
}
