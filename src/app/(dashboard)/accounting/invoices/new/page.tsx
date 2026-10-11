import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canAccessAccounting } from "@/lib/roleGuard"
import { loadInvoiceFormData } from "@/lib/invoiceFormData"
import InvoiceForm from "@/components/accounting/InvoiceForm"

/** Create a draft invoice. */
export default async function NewInvoicePage() {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/invoices")
  const data = await loadInvoiceFormData()
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-foreground">New invoice</h2>
      <InvoiceForm {...data} />
    </div>
  )
}
