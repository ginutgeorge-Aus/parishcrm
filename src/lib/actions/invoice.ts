"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { InvoiceStatus, UserRole } from "@/lib/generated/prisma/enums"
import { centsToDecimalString, computeInvoiceTotals, parseInvoiceDraft, type InvoiceDraftInput, type InvoiceLine } from "@/lib/invoice"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import type { ActionResult } from "./types"

const INVOICES_PATH = "/accounting/invoices"
const CHANGED = { error: "This invoice has changed. Reload and try again." }

export type InvoiceView = {
  id: number; invoiceNo: string | null; status: InvoiceStatus; personId: number | null; customerId: number | null
  recipientName: string; recipientEmail: string | null; recipientAddress: string | null
  issueDate: string; dueDate: string; lines: InvoiceLine[]; subtotal: string; gstTotal: string; total: string
  taxInvoice: boolean; accountId: number; accountName: string; fundId: number | null; fundName: string | null
  notes: string | null; sentAt: Date | null; paidAt: Date | null; voidedAt: Date | null; voidReason: string | null
  paymentTransactionId: number | null
}
export type InvoiceListRow = {
  id: number; invoiceNo: string | null; status: InvoiceStatus; recipientName: string
  issueDate: string; dueDate: string; total: string; gstTotal: string; paidAt: Date | null
}

const ymdOf = (d: Date) => d.toISOString().slice(0, 10)
const encOrNull = (v: string) => (v ? encrypt(v) : null)
const decOrNull = (v: string | null) => (v ? safeDecrypt(v) : null)

/** Check the referenced account/fund/recipient exist and are usable. Returns an error message or null. */
async function validateRefs(d: InvoiceDraftInput): Promise<string | null> {
  const account = await prisma.account.findUnique({ where: { id: d.accountId } })
  if (!account || account.type !== "INCOME" || !account.isActive) return "Choose an active income account"
  if (d.fundId !== null) {
    const fund = await prisma.fund.findUnique({ where: { id: d.fundId } })
    if (!fund || !fund.isActive) return "Choose an active fund"
  }
  if (d.recipientKind === "person" && d.recipientId !== null) {
    const p = await prisma.person.findUnique({ where: { id: d.recipientId }, select: { id: true } })
    if (!p) return "Recipient not found"
  }
  if (d.recipientKind === "customer" && d.recipientId !== null) {
    const c = await prisma.customer.findUnique({ where: { id: d.recipientId } })
    if (!c || !c.isActive) return "Recipient not found"
  }
  return null
}

/** Build the Prisma write payload for a draft: server-computed totals, encrypted contact fields. */
function toDraftData(d: InvoiceDraftInput, gstEnabled: boolean) {
  const t = computeInvoiceTotals(d.lines, gstEnabled)
  return {
    personId: d.recipientKind === "person" ? d.recipientId : null,
    customerId: d.recipientKind === "customer" ? d.recipientId : null,
    recipientName: d.recipientName,
    recipientEmail: encOrNull(d.recipientEmail),
    recipientAddress: encOrNull(d.recipientAddress),
    issueDate: new Date(d.issueDate),
    dueDate: new Date(d.dueDate),
    lines: d.lines,
    subtotal: centsToDecimalString(t.subtotalCents),
    gstTotal: centsToDecimalString(t.gstCents),
    total: centsToDecimalString(t.totalCents),
    accountId: d.accountId,
    fundId: d.fundId,
    notes: encOrNull(d.notes),
  }
}

/** Create a DRAFT invoice (ADMIN | PASTOR). No number is allocated until it is sent. */
export async function createInvoice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = parseInvoiceDraft(formData)
  if ("error" in parsed) return parsed
  const refErr = await validateRefs(parsed.data)
  if (refErr) return { error: refErr }
  const { gstRegistered } = await getInvoiceSettings()
  const data = toDraftData(parsed.data, gstRegistered)
  const uid = actorId(session)
  const row = await prisma.invoice.create({ data: { ...data, status: InvoiceStatus.DRAFT, createdById: uid } })
  await logAudit(uid, "INVOICE_CREATED", "Invoice", row.id, { total: data.total })
  revalidatePath(INVOICES_PATH)
  redirect(`${INVOICES_PATH}/${row.id}`)
}

/** Update a DRAFT invoice; sent/paid/void invoices are frozen. */
export async function updateInvoice(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = parseInvoiceDraft(formData)
  if ("error" in parsed) return parsed
  const refErr = await validateRefs(parsed.data)
  if (refErr) return { error: refErr }
  const { gstRegistered } = await getInvoiceSettings()
  const data = toDraftData(parsed.data, gstRegistered)
  const res = await prisma.invoice.updateMany({ where: { id, status: InvoiceStatus.DRAFT }, data })
  if (res.count === 0) return CHANGED
  await logAudit(actorId(session), "INVOICE_UPDATED", "Invoice", id, { total: data.total })
  revalidatePath(INVOICES_PATH)
  redirect(`${INVOICES_PATH}/${id}`)
}

/** Delete a DRAFT invoice. Numbered drafts (failed send) cannot be deleted — keeps the sequence gap-free. */
export async function deleteDraftInvoice(id: number): Promise<{ error: string } | { success: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const res = await prisma.invoice.deleteMany({ where: { id, status: InvoiceStatus.DRAFT, invoiceNo: null } })
  if (res.count === 0) return { error: "Only unnumbered draft invoices can be deleted" }
  await logAudit(actorId(session), "INVOICE_DELETED", "Invoice", id, {})
  revalidatePath(INVOICES_PATH)
  return { success: "Draft deleted" }
}

/** Load one invoice for viewers; AUDITOR never receives decrypted contact details or notes. */
export async function getInvoice(id: number): Promise<InvoiceView | null | { error: string }> {
  const session = await auth()
  const role = session?.user?.role
  if (!canViewAccounting(role)) return { error: "Unauthorized" }
  const r = await prisma.invoice.findUnique({
    where: { id },
    include: { account: { select: { name: true } }, fund: { select: { name: true } }, payment: { select: { id: true } } },
  })
  if (!r) return null
  const masked = role === UserRole.AUDITOR
  return {
    id: r.id, invoiceNo: r.invoiceNo, status: r.status, personId: r.personId, customerId: r.customerId,
    recipientName: r.recipientName,
    recipientEmail: masked ? null : decOrNull(r.recipientEmail),
    recipientAddress: masked ? null : decOrNull(r.recipientAddress),
    issueDate: ymdOf(r.issueDate), dueDate: ymdOf(r.dueDate), lines: r.lines as InvoiceLine[],
    subtotal: r.subtotal.toString(), gstTotal: r.gstTotal.toString(), total: r.total.toString(),
    taxInvoice: r.taxInvoice, accountId: r.accountId, accountName: r.account.name,
    fundId: r.fundId, fundName: r.fund?.name ?? null,
    notes: masked ? null : decOrNull(r.notes),
    sentAt: r.sentAt, paidAt: r.paidAt, voidedAt: r.voidedAt, voidReason: r.voidReason,
    paymentTransactionId: r.payment?.id ?? null,
  }
}

/** List invoices (no PII beyond recipient name) filtered by status and issue-date range. */
export async function listInvoices(filter: { status?: InvoiceStatus; from?: string; to?: string } = {}): Promise<InvoiceListRow[] | { error: string }> {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const issueDate: { gte?: Date; lte?: Date } = {}
  if (filter.from) issueDate.gte = new Date(filter.from)
  if (filter.to) issueDate.lte = new Date(filter.to)
  const rows = await prisma.invoice.findMany({
    where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.from || filter.to ? { issueDate } : {}) },
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take: 500,
    select: { id: true, invoiceNo: true, status: true, recipientName: true, issueDate: true, dueDate: true, total: true, gstTotal: true, paidAt: true },
  })
  return rows.map((r) => ({ ...r, issueDate: ymdOf(r.issueDate), dueDate: ymdOf(r.dueDate), total: r.total.toString(), gstTotal: r.gstTotal.toString() }))
}

/** Prefill contact for the picker: a member's email + their family address, or a customer's saved details. */
export async function getRecipientContact(kind: "person" | "customer", id: number): Promise<{ email: string; address: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (kind === "person") {
    const p = await prisma.person.findUnique({
      where: { id },
      select: { email: true, family: { select: { address: true, suburb: true, state: true, postcode: true } } },
    })
    if (!p) return { error: "Not found" }
    const f = p.family
    const line2 = [decOrNull(f?.suburb ?? null), decOrNull(f?.state ?? null), decOrNull(f?.postcode ?? null)].filter(Boolean).join(" ")
    const address = [decOrNull(f?.address ?? null), line2].filter(Boolean).join("\n")
    return { email: decOrNull(p.email) ?? "", address }
  }
  const c = await prisma.customer.findUnique({ where: { id } })
  if (!c) return { error: "Not found" }
  return { email: decOrNull(c.email) ?? "", address: decOrNull(c.address) ?? "" }
}
