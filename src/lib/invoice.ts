// Pure invoice maths, numbering and form parsing — NO prisma/server-only
// imports, so InvoiceForm (client) can reuse computeInvoiceTotals for its live
// preview while the server stays the source of truth for stored totals.
import { z } from "zod"
import { MONEY_DECIMAL_RE, isRealCalendarDate, isValidEmail, isValidPgId } from "@/lib/validation"
import { toCents } from "@/lib/formatting"

export const INVOICE_MAX_LINES = 50
export const GST_RATE_DIVISOR = 10 // 10% GST
/** Largest total a Decimal(10,2) column holds: 99,999,999.99. */
export const MAX_INVOICE_TOTAL_CENTS = 9_999_999_999

export type InvoiceLine = { description: string; qty: number; unitPriceCents: number; gst: boolean }
export type InvoiceTotals = { subtotalCents: number; gstCents: number; totalCents: number }

/** GST for one line in integer cents: 10% of qty × unit price, rounded half up; 0 when not applicable. */
export function lineGstCents(line: InvoiceLine, gstEnabled: boolean): number {
  if (!gstEnabled || !line.gst) return 0
  return Math.round((line.qty * line.unitPriceCents) / GST_RATE_DIVISOR)
}

/** Subtotal (GST-exclusive), GST and total for a set of lines, all in integer cents. */
export function computeInvoiceTotals(lines: InvoiceLine[], gstEnabled: boolean): InvoiceTotals {
  let subtotalCents = 0
  let gstCents = 0
  for (const l of lines) {
    subtotalCents += l.qty * l.unitPriceCents
    gstCents += lineGstCents(l, gstEnabled)
  }
  return { subtotalCents, gstCents, totalCents: subtotalCents + gstCents }
}

/** Integer cents → "1234.56" for a Prisma Decimal write. Throws on negative/non-integer input. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("centsToDecimalString: invalid cents")
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`
}

/** Display number for an invoice sequence: INV-0001. */
export function formatInvoiceNo(seq: number): string {
  return `INV-${String(seq).padStart(4, "0")}`
}

const ymd = (label: string) =>
  z.string().refine(isRealCalendarDate, `Invalid ${label}`)

export const InvoiceLineInputSchema = z.object({
  description: z.string().trim().min(1, "Each line needs a description").max(500),
  qty: z.coerce.string().regex(/^(?!0+$)\d{1,4}$/, "Quantity must be a whole number from 1 to 9999"),
  unitPrice: z.string().max(12).regex(MONEY_DECIMAL_RE, "Unit price must be a dollar amount with up to 2 decimals"),
  gst: z.boolean(),
})

export const InvoiceDraftSchema = z
  .object({
    recipientKind: z.enum(["person", "customer", "none"]),
    recipientId: z.string(),
    recipientName: z.string().trim().min(1, "Recipient name is required").max(200),
    recipientEmail: z.string().trim().max(254)
      .refine((e) => e === "" || isValidEmail(e), "Enter a valid email"),
    recipientAddress: z.string().trim().max(500),
    issueDate: ymd("issue date"),
    dueDate: ymd("due date"),
    accountId: z.string().regex(/^\d+$/, "Choose an income account"),
    fundId: z.string().regex(/^\d*$/, "Invalid fund"),
    notes: z.string().trim().max(2000),
    lines: z.array(InvoiceLineInputSchema).min(1, "Add at least one line").max(INVOICE_MAX_LINES, "Too many lines"),
  })
  .refine((d) => d.dueDate >= d.issueDate, { message: "Due date must be on or after the issue date" })
  .refine((d) => d.recipientKind === "none" || /^\d+$/.test(d.recipientId), { message: "Choose a recipient" })

export type InvoiceDraftInput = {
  recipientKind: "person" | "customer" | "none"
  recipientId: number | null
  recipientName: string
  recipientEmail: string
  recipientAddress: string
  issueDate: string
  dueDate: string
  accountId: number
  fundId: number | null
  notes: string
  lines: InvoiceLine[]
}

/** Parse + validate the invoice draft form (lines arrive as a JSON hidden field). */
export function parseInvoiceDraft(formData: FormData): { data: InvoiceDraftInput } | { error: string } {
  let rawLines: unknown
  try {
    rawLines = JSON.parse(String(formData.get("lines") ?? "[]"))
  } catch {
    return { error: "Invalid line items" }
  }
  const str = (k: string) => String(formData.get(k) ?? "")
  const parsed = InvoiceDraftSchema.safeParse({
    recipientKind: str("recipientKind"), recipientId: str("recipientId"), recipientName: str("recipientName"),
    recipientEmail: str("recipientEmail"), recipientAddress: str("recipientAddress"),
    issueDate: str("issueDate"), dueDate: str("dueDate"), accountId: str("accountId"),
    fundId: str("fundId"), notes: str("notes"), lines: rawLines,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid invoice" }
  const d = parsed.data
  const ids = [d.accountId, d.fundId, d.recipientKind === "none" ? "" : d.recipientId]
    .filter((v) => v !== "")
    .map((v) => Number.parseInt(v, 10))
  if (!ids.every(isValidPgId)) return { error: "Invalid reference" }
  const lines = d.lines.map((l) => ({
    description: l.description,
    qty: Number.parseInt(l.qty, 10),
    unitPriceCents: toCents(l.unitPrice),
    gst: l.gst,
  }))
  // Worst case (GST on) must still fit the Decimal(10,2) total column.
  if (computeInvoiceTotals(lines, true).totalCents > MAX_INVOICE_TOTAL_CENTS) {
    return { error: "Invoice total is too large" }
  }
  return {
    data: {
      recipientKind: d.recipientKind,
      recipientId: d.recipientKind === "none" ? null : Number.parseInt(d.recipientId, 10),
      recipientName: d.recipientName,
      recipientEmail: d.recipientEmail,
      recipientAddress: d.recipientAddress,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      accountId: Number.parseInt(d.accountId, 10),
      fundId: d.fundId === "" ? null : Number.parseInt(d.fundId, 10),
      notes: d.notes,
      lines,
    },
  }
}
