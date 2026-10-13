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
import { centsToDecimalString, computeInvoiceTotals, INVOICE_LIST_LIMIT, parseInvoiceDraft, type InvoiceDraftInput, type InvoiceLine } from "@/lib/invoice"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { Prisma } from "@/lib/generated/prisma/client"
import { isP2034, isRealCalendarDate, isValidPgId, parseOptimisticUpdatedAt } from "@/lib/validation"
import { toCents } from "@/lib/formatting"
import { endOfDayUTC } from "@/lib/dates"
import type { ActionResult } from "./types"

const INVOICES_PATH = "/accounting/invoices"
const CHANGED = { error: "This invoice has changed. Reload and try again." }
const BUSY = { error: "Couldn't save the invoice. Try again." }
const MAX_TX_ATTEMPTS = 3

export type InvoiceView = {
  id: number; invoiceNo: string | null; status: InvoiceStatus; personId: number | null; customerId: number | null
  recipientName: string; recipientEmail: string | null; recipientAddress: string | null
  issueDate: string; dueDate: string; lines: InvoiceLine[]; subtotal: string; gstTotal: string; total: string
  taxInvoice: boolean; accountId: number; accountName: string; fundId: number | null; fundName: string | null
  notes: string | null; sentAt: Date | null; paidAt: Date | null; voidedAt: Date | null; voidReason: string | null
  paymentTransactionId: number | null
  /** Optimistic-concurrency token: the edit form round-trips it so a stale draft save is rejected. */
  updatedAt: Date
}
export type InvoiceListRow = {
  id: number; invoiceNo: string | null; status: InvoiceStatus; recipientName: string
  issueDate: string; dueDate: string; total: string; gstTotal: string; paidAt: Date | null
}

const ymdOf = (d: Date) => d.toISOString().slice(0, 10)

/** True for a Postgres foreign-key violation (P2003): the referenced account was deleted mid-write. */
function isFkViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false
  const err = e as { code?: string; cause?: { kind?: string } }
  return err.code === "P2003" || err.cause?.kind === "ForeignKeyConstraintViolation"
}

/**
 * Run an invoice write that validates its account and inserts/updates in one Serializable transaction.
 *
 * Ordering vs `updateAccount` (retype) and `deleteAccount`: those run Serializable too, and read the invoices
 * that point at the account. This write reads the account (type/active) then writes an invoice. Each side reads
 * what the other writes, so Postgres sees a dependency cycle and aborts one of them (P2034) instead of letting
 * both commit — an invoice can never land on an account that was retyped or deleted in the same instant. The
 * loser (P2034, or an FK violation when the account vanished first) is retried: the re-run re-validates against
 * the committed state and returns the normal "Choose an active income account" message, or succeeds.
 */
async function serializableWrite<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | { error: string }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (e) {
      if (!isP2034(e) && !isFkViolation(e)) throw e
      if (attempt >= MAX_TX_ATTEMPTS) return BUSY
    }
  }
}

/**
 * Check the referenced account/fund/recipient exist and are usable. Returns an error message or null.
 * `keepCustomerId` lets a draft keep a customer that was deactivated after it was addressed.
 * `db` is the transaction client when called inside {@link serializableWrite}.
 */
async function validateRefs(d: InvoiceDraftInput, keepCustomerId: number | null, db: Prisma.TransactionClient): Promise<string | null> {
  const account = await db.account.findUnique({ where: { id: d.accountId } })
  if (!account || account.type !== "INCOME" || !account.isActive) return "Choose an active income account"
  if (d.fundId !== null) {
    const fund = await db.fund.findUnique({ where: { id: d.fundId } })
    if (!fund || !fund.isActive) return "Choose an active fund"
  }
  if (d.recipientKind === "person" && d.recipientId !== null) {
    const p = await db.person.findUnique({ where: { id: d.recipientId }, select: { id: true } })
    if (!p) return "Recipient not found"
  }
  if (d.recipientKind === "customer" && d.recipientId !== null) {
    const c = await db.customer.findUnique({ where: { id: d.recipientId } })
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
  const { gstRegistered } = await getInvoiceSettings()
  const data = toDraftData(parsed.data, gstRegistered)
  const uid = actorId(session)
  // Validate the account and insert in one Serializable transaction so a concurrent retype/delete of it can't slip between.
  const created = await serializableWrite<{ error: string } | { row: { id: number } }>(async (tx) => {
    const refErr = await validateRefs(parsed.data, null, tx)
    if (refErr) return { error: refErr }
    return { row: await tx.invoice.create({ data: { ...data, status: InvoiceStatus.DRAFT, createdById: uid } }) }
  })
  if (!("row" in created)) return created
  const { row } = created
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
  const { gstRegistered } = await getInvoiceSettings()
  const data = toDraftData(parsed.data, gstRegistered)
  // Optimistic concurrency: the edit form submits the draft's last-seen updatedAt and the write matches on it, so
  // two people editing the same draft can't silently overwrite each other (the later save matches 0 rows -> CHANGED).
  // A missing token (older cached form) falls back to the status-only guard. Account validation and the write share
  // one Serializable transaction (see serializableWrite) so a concurrent account retype can't slip between them.
  const seenAt = parseOptimisticUpdatedAt(formData)
  const result = await serializableWrite(async (tx) => {
    const current = await tx.invoice.findUnique({ where: { id }, select: { customerId: true } })
    if (!current) return { error: "Invoice not found" }
    const refErr = await validateRefs(parsed.data, current.customerId, tx)
    if (refErr) return { error: refErr }
    // Explicit updatedAt: it is the version the send path checks, so never rely on implicit bumps.
    const res = await tx.invoice.updateMany({
      where: { id, status: InvoiceStatus.DRAFT, ...(seenAt ? { updatedAt: seenAt } : {}) },
      data: { ...data, updatedAt: new Date() },
    })
    return res.count === 0 ? CHANGED : null
  })
  if (result) return result
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
    updatedAt: r.updatedAt,
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
    take: INVOICE_LIST_LIMIT,
    select: { id: true, invoiceNo: true, status: true, recipientName: true, issueDate: true, dueDate: true, total: true, gstTotal: true, paidAt: true, lines: true },
  })
  const { gstRegistered } = await getInvoiceSettings()
  return rows.map(({ lines, ...r }) => {
    // Drafts show totals for the current GST setting (same as the detail page and draft PDF).
    const t = r.status === InvoiceStatus.DRAFT ? computeInvoiceTotals(lines as InvoiceLine[], gstRegistered) : null
    return {
      ...r, issueDate: ymdOf(r.issueDate), dueDate: ymdOf(r.dueDate),
      total: t ? centsToDecimalString(t.totalCents) : r.total.toString(),
      gstTotal: t ? centsToDecimalString(t.gstCents) : r.gstTotal.toString(),
    }
  })
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
