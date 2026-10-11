import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { fmtAUD, centsToNumber, toCents } from "@/lib/formatting"
import { getInvoice } from "@/lib/actions/invoice"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { computeInvoiceTotals, lineGstCents } from "@/lib/invoice"
import { sydneyTodayYMD } from "@/lib/dates"
import { UserRole } from "@/lib/generated/prisma/enums"
import { Button } from "@/components/ui/button"
import { InvoiceStatusBadge } from "@/components/accounting/InvoiceStatusBadge"
import { DeleteDraftButton } from "@/components/accounting/InvoiceRowActions"
import { InvoiceSendActions } from "@/components/accounting/InvoiceSendActions"

const money = (cents: number) => fmtAUD(centsToNumber(cents))

/** Invoice detail: recipient, lines, totals and status-dependent actions. */
export default async function InvoicePage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const params = await props.params
  const session = await auth()
  const role = session?.user?.role
  if (!canViewAccounting(role)) redirect("/")
  const id = parseRouteId(params.id)
  if (id === null) notFound()
  const inv = await getInvoice(id)
  if (!inv || "error" in inv) notFound()
  const canManage = canAccessAccounting(role)
  const { gstRegistered } = await getInvoiceSettings()
  const showGst = inv.status === "DRAFT" ? gstRegistered : inv.taxInvoice
  // Drafts: recompute with the current GST setting (stored totals date from the last save).
  const totals = inv.status === "DRAFT"
    ? computeInvoiceTotals(inv.lines, showGst)
    : { subtotalCents: toCents(inv.subtotal), gstCents: toCents(inv.gstTotal), totalCents: toCents(inv.total) }
  const day = (d: Date) => sydneyTodayYMD(d)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold text-foreground">
            {showGst ? "Tax invoice" : "Invoice"} {inv.invoiceNo ?? "(draft)"}
          </h2>
          <InvoiceStatusBadge status={inv.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {role !== UserRole.AUDITOR && (
            <Button asChild variant="outline"><a href={`/accounting/invoices/${inv.id}/pdf`}>Download PDF</a></Button>
          )}
          {canManage && inv.status === "DRAFT" && (
            <>
              <Button asChild variant="outline"><Link href={`/accounting/invoices/${inv.id}/edit`}>Edit</Link></Button>
              {!inv.invoiceNo && <DeleteDraftButton id={inv.id} />}
            </>
          )}
        </div>
      </div>

      {canManage && (inv.status === "DRAFT" || inv.status === "SENT") && (
        <InvoiceSendActions id={inv.id} status={inv.status} hasEmail={!!inv.recipientEmail} />
      )}

      <dl className="grid gap-4 rounded-lg border border-border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Recipient</dt>
          <dd className="font-medium">{inv.recipientName}</dd>
          {inv.recipientAddress && <dd className="whitespace-pre-line">{inv.recipientAddress}</dd>}
          {inv.recipientEmail && <dd>{inv.recipientEmail}</dd>}
        </div>
        <div className="space-y-1">
          <div className="flex justify-between"><dt className="text-muted-foreground">Issued</dt><dd>{inv.issueDate}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Due</dt><dd>{inv.dueDate}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Income account</dt><dd>{inv.accountName}</dd></div>
          {inv.fundName && <div className="flex justify-between"><dt className="text-muted-foreground">Fund</dt><dd>{inv.fundName}</dd></div>}
        </div>
      </dl>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              {showGst && <th className="px-3 py-2 text-right font-medium">GST</th>}
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">{l.description}</td>
                <td className="px-3 py-2 text-right">{l.qty}</td>
                <td className="px-3 py-2 text-right">{money(l.unitPriceCents)}</td>
                {showGst && <td className="px-3 py-2 text-right">{money(lineGstCents(l, true))}</td>}
                <td className="px-3 py-2 text-right">{money(l.qty * l.unitPriceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto w-64 space-y-1 text-sm">
        {showGst && (
          <>
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(totals.subtotalCents)}</dd></div>
            <div className="flex justify-between"><dt>GST</dt><dd>{money(totals.gstCents)}</dd></div>
          </>
        )}
        <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{money(totals.totalCents)}</dd></div>
      </dl>

      {inv.notes && <p className="whitespace-pre-line text-sm"><span className="text-muted-foreground">Notes: </span>{inv.notes}</p>}

      <ul className="space-y-1 text-sm text-muted-foreground">
        {inv.sentAt && <li>Sent {day(inv.sentAt)}</li>}
        {inv.paidAt && <li>Paid {day(inv.paidAt)}</li>}
        {inv.voidedAt && <li>Voided {day(inv.voidedAt)}{inv.voidReason ? ` — ${inv.voidReason}` : ""}</li>}
      </ul>
    </div>
  )
}
