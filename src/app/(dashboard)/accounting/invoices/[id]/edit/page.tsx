import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { canAccessAccounting } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { getInvoice } from "@/lib/actions/invoice"
import { loadInvoiceFormData } from "@/lib/invoiceFormData"
import InvoiceForm from "@/components/accounting/InvoiceForm"

/** Edit a draft invoice; anything already sent redirects to its detail page. */
export default async function EditInvoicePage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const params = await props.params
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/invoices")
  const id = parseRouteId(params.id)
  if (id === null) notFound()
  const invoice = await getInvoice(id)
  if (!invoice || "error" in invoice) notFound()
  if (invoice.status !== "DRAFT") redirect(`/accounting/invoices/${id}`)
  const data = await loadInvoiceFormData()
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-foreground">Edit draft invoice</h2>
      <InvoiceForm {...data} edit={invoice} />
    </div>
  )
}
