"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { isValidPgId } from "@/lib/validation"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import { featureGuard } from "@/lib/featureFlags"

/** Void a SENT invoice with a reason. The number stays used; PAID must be unmarked first. */
export async function voidInvoice(id: number, reason: string): Promise<{ success: string } | { error: string }> {
  const off = await featureGuard("invoices")
  if (off) return off
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const r = typeof reason === "string" ? reason.trim() : ""
  if (!r) return { error: "Give a reason for voiding" }
  if (r.length > 500) return { error: "Reason must be 500 characters or fewer" }
  const inv = isValidPgId(id) ? await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true } }) : null
  if (!inv) return { error: "Invoice not found" }
  if (inv.status === InvoiceStatus.PAID) return { error: "Unmark the payment before voiding" }
  if (inv.status !== InvoiceStatus.SENT) return { error: "Only sent invoices can be voided — delete the draft instead" }
  const res = await prisma.invoice.updateMany({ where: { id, status: InvoiceStatus.SENT }, data: { status: InvoiceStatus.VOID, voidedAt: new Date(), voidReason: r } })
  if (res.count === 0) return { error: "This invoice has changed. Reload and try again." }
  await logAudit(actorId(session), "INVOICE_VOIDED", "Invoice", id, { invoiceNo: inv.invoiceNo })
  revalidatePath("/accounting/invoices")
  revalidatePath(`/accounting/invoices/${id}`)
  return { success: `${inv.invoiceNo} voided` }
}
