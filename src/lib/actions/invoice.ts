"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { encryptOrNull, decryptOrNull } from "@/lib/nullableCrypto"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { InvoiceStatus, UserRole } from "@/lib/generated/prisma/enums"
import { centsToDecimalString, computeInvoiceTotals, INVOICE_PAGE_SIZE, formatInvoiceCursor, parseInvoiceCursor, parseInvoiceDraft, type InvoiceDraftInput, type InvoiceLine } from "@/lib/invoice"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { isRealCalendarDate, isValidPgId } from "@/lib/validation"
import { toCents } from "@/lib/formatting"
import { endOfDayUTC } from "@/lib/dates"
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
type InvoiceListRow = {
  id: number; invoiceNo: string | null; status: InvoiceStatus; recipientName: string
  issueDate: string; dueDate: string; total: string; gstTotal: string; paidAt: Date | null
}

const ymdOf = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Check the referenced account/fund/recipient exist and are usable. Returns an error message or null.
 * `keepCustomerId` lets a draft keep a customer that was deactivated after it was addressed.
 */
async function validateRefs(d: InvoiceDraftInput, keepCustomerId: number | null = null): Promise<string | null> {
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
    if (!c || (!c.isActive && c.id !== keepCustomerId)) return "Recipient not found"
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
    recipientEmail: encryptOrNull(d.recipientEmail),
    recipientAddress: encryptOrNull(d.recipientAddress),
    issueDate: new Date(d.issueDate),
    dueDate: new Date(d.dueDate),
    lines: d.lines,
    subtotal: centsToDecimalString(t.subtotalCents),
    gstTotal: centsToDecimalString(t.gstCents),
    total: centsToDecimalString(t.totalCents),
    accountId: d.accountId,
    fundId: d.fundId,
    notes: encryptOrNull(d.notes),
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
  if (!isValidPgId(id)) return { error: "Invoice not found" }
  const parsed = parseInvoiceDraft(formData)
  if ("error" in parsed) return parsed
  const current = await prisma.invoice.findUnique({ where: { id }, select: { customerId: true } })
  if (!current) return { error: "Invoice not found" }
  const refErr = await validateRefs(parsed.data, current.customerId)
  if (refErr) return { error: refErr }
  const { gstRegistered } = await getInvoiceSettings()
  const data = toDraftData(parsed.data, gstRegistered)
  // Explicit updatedAt: it is the version the send path checks, so never rely on implicit bumps.
  const res = await prisma.invoice.updateMany({ where: { id, status: InvoiceStatus.DRAFT }, data: { ...data, updatedAt: new Date() } })
  if (res.count === 0) return CHANGED
  await logAudit(actorId(session), "INVOICE_UPDATED", "Invoice", id, { total: data.total })
  revalidatePath(INVOICES_PATH)
  redirect(`${INVOICES_PATH}/${id}`)
}

/** Delete a DRAFT invoice. Numbered drafts (failed send) cannot be deleted — keeps the sequence gap-free. */
export async function deleteDraftInvoice(id: number): Promise<{ error: string } | { success: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invoice not found" }
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
  if (!isValidPgId(id)) return null
  const r = await prisma.invoice.findUnique({
    where: { id },
    include: { account: { select: { name: true } }, fund: { select: { name: true } }, payment: { select: { id: true } } },
  })
  if (!r) return null
  const masked = role === UserRole.AUDITOR
  return {
    id: r.id, invoiceNo: r.invoiceNo, status: r.status, personId: r.personId, customerId: r.customerId,
    recipientName: r.recipientName,
    recipientEmail: masked ? null : decryptOrNull(r.recipientEmail),
    recipientAddress: masked ? null : decryptOrNull(r.recipientAddress),
    issueDate: ymdOf(r.issueDate), dueDate: ymdOf(r.dueDate), lines: r.lines as InvoiceLine[],
    subtotal: r.subtotal.toString(), gstTotal: r.gstTotal.toString(), total: r.total.toString(),
    taxInvoice: r.taxInvoice, accountId: r.accountId, accountName: r.account.name,
    fundId: r.fundId, fundName: r.fund?.name ?? null,
    notes: masked ? null : decryptOrNull(r.notes),
    sentAt: r.sentAt, paidAt: r.paidAt, voidedAt: r.voidedAt, voidReason: r.voidReason,
    paymentTransactionId: r.payment?.id ?? null,
  }
}

export type InvoiceListFilter = { status?: InvoiceStatus; from?: string; to?: string; after?: string; before?: string }
export type InvoicePage = { rows: InvoiceListRow[]; nextCursor: string | null; prevCursor: string | null }

/**
 * One page of invoices (no PII beyond recipient name), newest first (`issueDate desc, id desc`),
 * filtered by status and issue-date range. `after` / `before` are keyset cursors from a previous
 * page's `nextCursor` / `prevCursor`; a malformed cursor is ignored (first page).
 */
export async function listInvoices(filter: InvoiceListFilter = {}): Promise<InvoicePage | { error: string }> {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const issueDate: { gte?: Date; lte?: Date } = {}
  if (filter.from) issueDate.gte = new Date(filter.from)
  if (filter.to) issueDate.lte = new Date(filter.to)
  const after = parseInvoiceCursor(filter.after)
  const before = after ? null : parseInvoiceCursor(filter.before)
  const cursor = after ?? before
  const day = cursor ? new Date(cursor.issueDate) : undefined
  const keyset = !cursor || !day ? {}
    : after ? { AND: [{ OR: [{ issueDate: { lt: day } }, { issueDate: day, id: { lt: cursor.id } }] }] }
    : { AND: [{ OR: [{ issueDate: { gt: day } }, { issueDate: day, id: { gt: cursor.id } }] }] }
  const found = await prisma.invoice.findMany({
    where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.from || filter.to ? { issueDate } : {}), ...keyset },
    orderBy: before ? [{ issueDate: "asc" }, { id: "asc" }] : [{ issueDate: "desc" }, { id: "desc" }],
    take: INVOICE_PAGE_SIZE + 1, // one extra row tells us whether another page exists
    select: { id: true, invoiceNo: true, status: true, recipientName: true, issueDate: true, dueDate: true, total: true, gstTotal: true, paidAt: true, lines: true },
  })
  const hasMore = found.length > INVOICE_PAGE_SIZE
  const page = found.slice(0, INVOICE_PAGE_SIZE)
  if (before) page.reverse() // fetched ascending to walk backwards; show newest first
  const edge = (r?: { issueDate: Date; id: number }) => (r ? formatInvoiceCursor({ issueDate: ymdOf(r.issueDate), id: r.id }) : null)
  // Arriving via `after` means rows newer than the cursor exist behind us; via `before`, older ones do.
  const nextCursor = (before || hasMore) && page.length ? edge(page.at(-1)) : null
  const prevCursor = ((after && page.length) || (before && hasMore)) ? edge(page[0]) : null
  const { gstRegistered } = await getInvoiceSettings()
  const rows = page.map(({ lines, ...r }) => {
    // Drafts show totals for the current GST setting (same as the detail page and draft PDF).
    const t = r.status === InvoiceStatus.DRAFT ? computeInvoiceTotals(lines as InvoiceLine[], gstRegistered) : null
    return {
      ...r, issueDate: ymdOf(r.issueDate), dueDate: ymdOf(r.dueDate),
      total: t ? centsToDecimalString(t.totalCents) : r.total.toString(),
      gstTotal: t ? centsToDecimalString(t.gstCents) : r.gstTotal.toString(),
    }
  })
  return { rows, nextCursor, prevCursor }
}

export type InvoiceSummary = { outstandingCents: number; outstandingCount: number; paidCents: number; paidCount: number; gstCollectedCents: number }

/** Outstanding (all SENT) plus paid and GST collected for invoices paid within [from, to] (cash basis), in cents. */
export async function getInvoiceSummary(period: { from: string; to: string }): Promise<InvoiceSummary | { error: string }> {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isRealCalendarDate(period?.from) || !isRealCalendarDate(period?.to) || period.from > period.to) return { error: "Invalid period" }
  const [outstanding, paid] = await Promise.all([
    prisma.invoice.aggregate({ where: { status: InvoiceStatus.SENT }, _sum: { total: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({
      where: { status: InvoiceStatus.PAID, paidAt: { gte: new Date(period.from), lte: endOfDayUTC(new Date(period.to)) } },
      _sum: { total: true, gstTotal: true }, _count: { _all: true },
    }),
  ])
  return {
    outstandingCents: toCents(outstanding._sum.total), outstandingCount: outstanding._count._all,
    paidCents: toCents(paid._sum.total), paidCount: paid._count._all, gstCollectedCents: toCents(paid._sum.gstTotal),
  }
}

/** Prefill contact for the picker: a member's email + their family address, or a customer's saved details. */
export async function getRecipientContact(kind: "person" | "customer", id: number): Promise<{ email: string; address: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Not found" }
  if (kind === "person") {
    const p = await prisma.person.findUnique({
      where: { id },
      select: { email: true, family: { select: { address: true, suburb: true, state: true, postcode: true } } },
    })
    if (!p) return { error: "Not found" }
    const f = p.family
    const line2 = [decryptOrNull(f?.suburb ?? null), decryptOrNull(f?.state ?? null), decryptOrNull(f?.postcode ?? null)].filter(Boolean).join(" ")
    const address = [decryptOrNull(f?.address ?? null), line2].filter(Boolean).join("\n")
    return { email: decryptOrNull(p.email) ?? "", address }
  }
  const c = await prisma.customer.findUnique({ where: { id } })
  if (!c) return { error: "Not found" }
  return { email: decryptOrNull(c.email) ?? "", address: decryptOrNull(c.address) ?? "" }
}
