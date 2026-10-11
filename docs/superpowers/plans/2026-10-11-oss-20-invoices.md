# Invoices (OSS-20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounting users create, send (email or self-delivered), download and track invoices to members or saved outside customers, then mark them paid by linking or creating an income transaction.

**Architecture:** New `Customer` and `Invoice` Prisma models plus `Transaction.invoiceId @unique`. Pure money/GST maths and zod schemas live in `src/lib/invoice.ts` (client-safe). Server actions in `src/lib/actions/customer.ts` and `src/lib/actions/invoice.ts` follow the `dgrReceipt.ts` pattern (auth gate → zod → prisma → `logAudit` → revalidate). PDF via PDFKit in `src/lib/pdf/InvoicePdf.ts`, served by a dashboard route handler like the DGR PDF route.

**Tech Stack:** Next.js 16 App Router + Server Actions, Prisma 7 (`@prisma/adapter-pg`), zod, PDFKit, nodemailer (`sendEmail`), Jest 30 + Testing Library, shadcn/ui (Popover + Command picker).

Spec: `docs/superpowers/specs/2026-10-11-invoices-design.md`.

## Global Constraints

- Public AGPL repo: synthetic data only in tests/fixtures (`Example Church`, `@example.com`).
- Mutations: `canAccessAccounting` (ADMIN | PASTOR) at page **and** action. Views: `canViewAccounting`.
- AUDITOR: never receives decrypted recipient/customer email, phone, address or notes; no PDF download; no recipient picker.
- Money: validate strings with `MONEY_DECIMAL_RE` before any write; maths in integer cents via `toCents`; write Decimals as strings from `centsToDecimalString`. Never `parseFloat`/`Number()` on money (semgrep `crm-no-float-money`).
- Encrypted columns: `Customer.email/phone/address/notes`, `Invoice.recipientEmail/recipientAddress/notes`. Register every one in `scripts/rotate-encryption-key.ts` `FIELDS` **and** `__tests__/scripts/rotate-encryption-key.test.ts` `CANONICAL`.
- Dates: form `YYYY-MM-DD` → `new Date(ymd)` (UTC midnight), validated with `isRealCalendarDate`, same as transactions.
- Status transitions use `updateMany({ where: { id, status: <expected> } })`; `count === 0` → `{ error: "This invoice has changed. Reload and try again." }`.
- Invoice number `INV-` + `seq` padded to 4; allocated on first send/mark-sent; `MAX(seq)+1` in `$transaction`, retry once on `isP2002`.
- Audit action strings: `INVOICE_CREATED`, `INVOICE_UPDATED`, `INVOICE_DELETED`, `INVOICE_SENT`, `INVOICE_SEND_FAILED`, `INVOICE_MARKED_SENT`, `INVOICE_RESENT`, `INVOICE_PAID`, `INVOICE_UNPAID`, `INVOICE_VOIDED`, `INVOICE_PDF_DOWNLOADED`, `CUSTOMER_CREATED`, `CUSTOMER_UPDATED`, `CUSTOMER_ACTIVE_SET`, `INVOICE_SETTINGS_UPDATED`. Never put PII in audit metadata.
- JSDoc on every new or changed function (repo convention).
- Tests: `npm test -- --testPathPatterns="<basename>"` (tests exist in both `src/**/__tests__` and root `__tests__/`).
- Do not add a `WHATS_NEW` entry (added only on the release PR).
- PR 1 = Tasks 1–9. PR 2 = Tasks 10–12. Each PR updates website docs for what it ships.

## File Map

| File | Responsibility | Task |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261011000000_invoices/migration.sql` | models | 1 |
| `scripts/rotate-encryption-key.ts`, `__tests__/scripts/rotate-encryption-key.test.ts` | encrypted-field registry | 1 |
| `src/lib/invoice.ts` + `src/lib/__tests__/invoice.test.ts` | pure maths, number format, zod schemas, types | 2 |
| `src/lib/invoiceSettingsShared.ts`, `src/lib/invoiceSettings.ts`, `src/lib/actions/invoiceSettings.ts`, `src/components/accounting/InvoiceSettingsForm.tsx` | GST + payment-details settings | 3 |
| `src/lib/actions/customer.ts`, `src/app/(dashboard)/accounting/customers/**`, `src/components/accounting/CustomerForm.tsx` | customers | 4 |
| `src/lib/actions/invoice.ts` (draft CRUD + reads) | invoice drafts | 5 |
| `src/components/accounting/InvoiceForm.tsx`, `src/components/accounting/RecipientPicker.tsx`, `src/app/(dashboard)/accounting/invoices/**` | invoice UI | 6 |
| `src/lib/pdf/InvoicePdf.ts`, `src/app/(dashboard)/accounting/invoices/[id]/pdf/route.ts` | PDF + download | 7 |
| `src/lib/actions/invoiceSend.ts`, `src/lib/invoiceEmail.ts`, `src/components/accounting/InvoiceSendActions.tsx` | send / mark sent / resend | 8 |
| `src/components/layout/sidebar/navData.ts`, website docs, README | nav + docs | 9 |
| `src/lib/actions/invoicePayment.ts`, `src/components/accounting/MarkPaidDialog.tsx` | mark paid / unmark | 10 |
| `src/lib/actions/invoiceVoid.ts`, `src/components/accounting/VoidInvoiceDialog.tsx` | void | 11 |
| `src/lib/invoiceSummary.ts`, invoices list page | totals + GST collected | 12 |

Splitting actions per lifecycle stage keeps each file under ~300 lines and lets PR 2 avoid touching PR 1 files except the detail page.

---

## PR 1 — Customers, drafts, PDF, send

### Task 1: Schema, migration, encryption registry

**Files:**
- Modify: `prisma/schema.prisma` (add `Customer`, `InvoiceStatus`, `Invoice`; relations on `Person`, `Account`, `Fund`, `User`, `Transaction`)
- Create: `prisma/migrations/20261011000000_invoices/migration.sql` (generated)
- Modify: `scripts/rotate-encryption-key.ts` (`FIELDS`)
- Modify: `__tests__/scripts/rotate-encryption-key.test.ts` (`CANONICAL`, ~line 377)

**Interfaces:**
- Produces: Prisma delegates `prisma.customer`, `prisma.invoice`; enum `InvoiceStatus` from `@/lib/generated/prisma/enums`; `Transaction.invoiceId Int? @unique`.

- [ ] **Step 1: Update the registry test first (failing)**

In `__tests__/scripts/rotate-encryption-key.test.ts`, add to the `CANONICAL` object (keep alphabetical position consistent with neighbours):

```ts
  customer: ["email", "phone", "address", "notes"],
  invoice: ["recipientEmail", "recipientAddress", "notes"],
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -- --testPathPatterns="rotate-encryption-key"`
Expected: FAIL on `expect(FIELDS).toEqual(CANONICAL)` (missing `customer`, `invoice`).

- [ ] **Step 3: Add the same two entries to `FIELDS` in `scripts/rotate-encryption-key.ts`** (line ~36, same shape/order).

- [ ] **Step 4: Add models to `prisma/schema.prisma`** (append near `DgrReceipt`):

```prisma
/// Saved outside party that can be invoiced (not a church member).
model Customer {
  id        Int       @id @default(autoincrement())
  name      String
  abn       String?
  email     String? /// encrypted
  phone     String? /// encrypted
  address   String? /// encrypted
  notes     String? /// encrypted
  isActive  Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  invoices  Invoice[]

  @@index([isActive, name])
}

enum InvoiceStatus {
  DRAFT
  SENT
  PAID
  VOID
}

model Invoice {
  id               Int           @id @default(autoincrement())
  invoiceNo        String?       @unique
  seq              Int?          @unique
  status           InvoiceStatus @default(DRAFT)
  personId         Int?
  person           Person?       @relation(fields: [personId], references: [id], onDelete: SetNull)
  customerId       Int?
  customer         Customer?     @relation(fields: [customerId], references: [id], onDelete: SetNull)
  recipientName    String
  recipientEmail   String? /// encrypted
  recipientAddress String? /// encrypted
  issueDate        DateTime
  dueDate          DateTime
  lines            Json
  subtotal         Decimal       @db.Decimal(10, 2)
  gstTotal         Decimal       @db.Decimal(10, 2)
  total            Decimal       @db.Decimal(10, 2)
  taxInvoice       Boolean       @default(false)
  accountId        Int
  account          Account       @relation(fields: [accountId], references: [id])
  fundId           Int?
  fund             Fund?         @relation(fields: [fundId], references: [id])
  notes            String? /// encrypted
  sentAt           DateTime?
  paidAt           DateTime?
  voidedAt         DateTime?
  voidReason       String?
  createdById      Int
  createdBy        User          @relation("InvoiceCreatedBy", fields: [createdById], references: [id])
  sentById         Int?
  sentBy           User?         @relation("InvoiceSentBy", fields: [sentById], references: [id])
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  payment          Transaction?

  @@index([status, issueDate])
}
```

Add back-relations: `Person { invoices Invoice[] }`, `Account { invoices Invoice[] }`, `Fund { invoices Invoice[] }`, `User { invoicesCreated Invoice[] @relation("InvoiceCreatedBy")  invoicesSent Invoice[] @relation("InvoiceSentBy") }`, and on `Transaction`:

```prisma
  invoiceId Int?     @unique
  invoice   Invoice? @relation(fields: [invoiceId], references: [id], onDelete: SetNull)
```

- [ ] **Step 5: Generate the migration against a throwaway DB**

```bash
npx prisma dev --detach            # prints a DATABASE_URL for a throwaway DB
export DATABASE_URL="<url printed above>"
npx prisma migrate deploy
mkdir -p prisma/migrations/20261011000000_invoices
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script \
  > prisma/migrations/20261011000000_invoices/migration.sql
npx prisma migrate deploy
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code
```

Expected: last command exits 0 (no drift). Inspect `migration.sql`: only `CREATE TYPE "InvoiceStatus"`, `CREATE TABLE "Customer"`, `CREATE TABLE "Invoice"`, `ALTER TABLE "Transaction" ADD COLUMN "invoiceId"`, indexes and FKs. No `DROP`.

- [ ] **Step 6: Regenerate client and run tests**

Run: `npx prisma generate && npm test -- --testPathPatterns="rotate-encryption-key|encryption-coverage"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma scripts/rotate-encryption-key.ts __tests__/scripts/rotate-encryption-key.test.ts
git commit -m "feat(invoices): add Customer and Invoice models"
```

---

### Task 2: Pure invoice maths, numbering and schemas

**Files:**
- Create: `src/lib/invoice.ts`
- Test: `src/lib/__tests__/invoice.test.ts`

**Interfaces:**
- Produces:
  - `type InvoiceLine = { description: string; qty: number; unitPriceCents: number; gst: boolean }`
  - `type InvoiceTotals = { subtotalCents: number; gstCents: number; totalCents: number }`
  - `lineGstCents(line: InvoiceLine, gstEnabled: boolean): number`
  - `computeInvoiceTotals(lines: InvoiceLine[], gstEnabled: boolean): InvoiceTotals`
  - `centsToDecimalString(cents: number): string`
  - `formatInvoiceNo(seq: number): string`
  - `InvoiceLineInputSchema`, `InvoiceDraftSchema` (zod) and `type InvoiceDraftInput`
  - `parseInvoiceDraft(formData: FormData): { data: InvoiceDraftInput } | { error: string }`
  - `INVOICE_MAX_LINES = 50`

- [ ] **Step 1: Write failing tests** — `src/lib/__tests__/invoice.test.ts`:

```ts
import {
  lineGstCents, computeInvoiceTotals, centsToDecimalString, formatInvoiceNo, parseInvoiceDraft,
} from "@/lib/invoice"

const line = (o: Partial<{ description: string; qty: number; unitPriceCents: number; gst: boolean }> = {}) =>
  ({ description: "Hall hire", qty: 1, unitPriceCents: 10000, gst: true, ...o })

describe("lineGstCents", () => {
  it("is 10% of the line total when GST is on", () => expect(lineGstCents(line(), true)).toBe(1000))
  it("is 0 when the line is not GST-able", () => expect(lineGstCents(line({ gst: false }), true)).toBe(0))
  it("is 0 when the church is not GST registered", () => expect(lineGstCents(line(), false)).toBe(0))
  it("rounds half up to the cent", () => expect(lineGstCents(line({ unitPriceCents: 1005 }), true)).toBe(101))
  it("multiplies by quantity before rounding", () => expect(lineGstCents(line({ qty: 3, unitPriceCents: 333 }), true)).toBe(100))
})

describe("computeInvoiceTotals", () => {
  it("sums subtotal, GST and total", () => {
    expect(computeInvoiceTotals([line(), line({ qty: 2, unitPriceCents: 2550, gst: false })], true))
      .toEqual({ subtotalCents: 15100, gstCents: 1000, totalCents: 16100 })
  })
  it("returns zeros for no lines", () => {
    expect(computeInvoiceTotals([], true)).toEqual({ subtotalCents: 0, gstCents: 0, totalCents: 0 })
  })
})

describe("centsToDecimalString", () => {
  it.each([[0, "0.00"], [5, "0.05"], [123456, "1234.56"], [100, "1.00"]])("%i → %s", (c, s) =>
    expect(centsToDecimalString(c)).toBe(s))
  it("throws on non-integer or negative", () => {
    expect(() => centsToDecimalString(1.5)).toThrow()
    expect(() => centsToDecimalString(-1)).toThrow()
  })
})

describe("formatInvoiceNo", () => {
  it("pads to 4 digits", () => expect(formatInvoiceNo(7)).toBe("INV-0007"))
  it("grows past 9999", () => expect(formatInvoiceNo(12345)).toBe("INV-12345"))
})

function fd(over: Record<string, string> = {}, lines: unknown = [{ description: "Hall hire", qty: "2", unitPrice: "150.00", gst: true }]) {
  const f = new FormData()
  const base: Record<string, string> = {
    recipientKind: "customer", recipientId: "3", recipientName: "Example Scouts",
    recipientEmail: "scouts@example.com", recipientAddress: "1 Example St",
    issueDate: "2026-10-11", dueDate: "2026-10-25", accountId: "4", fundId: "", notes: "",
    lines: JSON.stringify(lines), ...over,
  }
  for (const [k, v] of Object.entries(base)) f.set(k, v)
  return f
}

describe("parseInvoiceDraft", () => {
  it("parses a valid draft into cents", () => {
    const r = parseInvoiceDraft(fd())
    expect("data" in r && r.data).toMatchObject({
      recipientKind: "customer", recipientId: 3, accountId: 4, fundId: null,
      lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }],
    })
  })
  it("allows a manual recipient with no link", () => {
    const r = parseInvoiceDraft(fd({ recipientKind: "none", recipientId: "" }))
    expect("data" in r && r.data.recipientId).toBeNull()
  })
  it.each([
    [{ recipientName: "" }, "Recipient name is required"],
    [{ recipientEmail: "nope" }, "Enter a valid email"],
    [{ issueDate: "2026-02-30" }, "Invalid issue date"],
    [{ dueDate: "2026-10-01" }, "Due date must be on or after the issue date"],
    [{ accountId: "" }, "Choose an income account"],
  ])("rejects %o", (over, msg) => {
    expect(parseInvoiceDraft(fd(over))).toEqual({ error: msg })
  })
  it("rejects a float-y price", () => {
    expect(parseInvoiceDraft(fd({}, [{ description: "x", qty: "1", unitPrice: "1.005", gst: false }])))
      .toEqual({ error: "Unit price must be a dollar amount with up to 2 decimals" })
  })
  it("rejects no lines", () => expect(parseInvoiceDraft(fd({}, []))).toEqual({ error: "Add at least one line" }))
  it("rejects a non-integer quantity", () => {
    expect(parseInvoiceDraft(fd({}, [{ description: "x", qty: "1.5", unitPrice: "1", gst: false }])))
      .toEqual({ error: "Quantity must be a whole number from 1 to 9999" })
  })
  it("rejects malformed lines JSON", () => expect(parseInvoiceDraft(fd({ lines: "{" }))).toEqual({ error: "Invalid line items" }))
})
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '@/lib/invoice'`)

Run: `npm test -- --testPathPatterns="lib/__tests__/invoice.test"`

- [ ] **Step 3: Implement `src/lib/invoice.ts`**

```ts
// Pure invoice maths, numbering and form parsing — NO prisma/server-only
// imports, so InvoiceForm (client) can reuse computeInvoiceTotals for its live
// preview while the server stays the source of truth for stored totals.
import { z } from "zod"
import { MONEY_DECIMAL_RE, isRealCalendarDate, isValidEmail } from "@/lib/validation"
import { toCents } from "@/lib/formatting"

export const INVOICE_MAX_LINES = 50
export const GST_RATE_DIVISOR = 10 // 10% GST

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
  qty: z.coerce.string().regex(/^\d{1,4}$/, "Quantity must be a whole number from 1 to 9999")
    .refine((q) => q !== "0" && !/^0+$/.test(q), "Quantity must be a whole number from 1 to 9999"),
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
      lines: d.lines.map((l) => ({
        description: l.description,
        qty: Number.parseInt(l.qty, 10),
        unitPriceCents: toCents(l.unitPrice),
        gst: l.gst,
      })),
    },
  }
}
```

- [ ] **Step 4: Run — expect PASS.** Fix messages until the table in Step 1 matches exactly.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invoice.ts src/lib/__tests__/invoice.test.ts
git commit -m "feat(invoices): add pure totals, GST and draft parsing"
```

---

### Task 3: Invoice settings (GST registered, payment details)

**Files:**
- Create: `src/lib/invoiceSettingsShared.ts`, `src/lib/invoiceSettings.ts`, `src/lib/actions/invoiceSettings.ts`, `src/components/accounting/InvoiceSettingsForm.tsx`
- Modify: `src/app/(dashboard)/accounting/settings/page.tsx` (add a card)
- Test: `src/lib/actions/__tests__/invoiceSettings.test.ts`

**Interfaces:**
- Produces: `type InvoiceSettings = { gstRegistered: boolean; paymentDetails: string }`; `getInvoiceSettings(): Promise<InvoiceSettings>`; `updateInvoiceSettings(input: { gstRegistered: boolean; paymentDetails: string }): Promise<{ ok: true } | { error: string }>`.

- [ ] **Step 1: Failing test** — `src/lib/actions/__tests__/invoiceSettings.test.ts`:

```ts
import { updateInvoiceSettings } from "@/lib/actions/invoiceSettings"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findMany: jest.fn(), upsert: jest.fn() }, $transaction: jest.fn() },
}))

const mockAuth = auth as jest.Mock
beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (ops: unknown[]) => ops)
})

describe("getInvoiceSettings", () => {
  it("defaults when nothing is stored", async () => {
    ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([])
    expect(await getInvoiceSettings()).toEqual({ gstRegistered: false, paymentDetails: "" })
  })
  it("reads stored values", async () => {
    ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([
      { key: "invoiceGstRegistered", value: "true" }, { key: "invoicePaymentDetails", value: "BSB 000-000" },
    ])
    expect(await getInvoiceSettings()).toEqual({ gstRegistered: true, paymentDetails: "BSB 000-000" })
  })
})

describe("updateInvoiceSettings", () => {
  it.each(["PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER"])("rejects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    expect(await updateInvoiceSettings({ gstRegistered: true, paymentDetails: "" })).toEqual({ error: "Unauthorized" })
  })
  it("upserts both keys and audits", async () => {
    expect(await updateInvoiceSettings({ gstRegistered: true, paymentDetails: "BSB 000-000" })).toEqual({ ok: true })
    expect(prisma.appSetting.upsert).toHaveBeenCalledTimes(2)
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_SETTINGS_UPDATED", "AppSetting", undefined, { gstRegistered: true })
  })
  it("rejects over-long payment details", async () => {
    expect(await updateInvoiceSettings({ gstRegistered: false, paymentDetails: "x".repeat(1001) }))
      .toEqual({ error: "Payment details must be 1000 characters or fewer" })
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `npm test -- --testPathPatterns="invoiceSettings"`

- [ ] **Step 3: Implement**

`src/lib/invoiceSettingsShared.ts`:

```ts
// Client-safe invoice settings types/defaults (no prisma import).
export type InvoiceSettings = { gstRegistered: boolean; paymentDetails: string }
export const INVOICE_SETTING_KEYS = { gstRegistered: "invoiceGstRegistered", paymentDetails: "invoicePaymentDetails" } as const
export const INVOICE_PAYMENT_DETAILS_MAX = 1000
export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = { gstRegistered: false, paymentDetails: "" }
```

`src/lib/invoiceSettings.ts`:

```ts
import "server-only"
import { prisma } from "@/lib/prisma"
import { DEFAULT_INVOICE_SETTINGS, INVOICE_SETTING_KEYS, type InvoiceSettings } from "@/lib/invoiceSettingsShared"

export * from "@/lib/invoiceSettingsShared"

/** Read invoice settings from AppSetting, falling back to defaults per field. No auth check (callers gate). */
export async function getInvoiceSettings(): Promise<InvoiceSettings> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: Object.values(INVOICE_SETTING_KEYS) } },
  })
  const map = new Map(rows.map((r) => [r.key, r.value]))
  return {
    gstRegistered: map.get(INVOICE_SETTING_KEYS.gstRegistered) === "true",
    paymentDetails: map.get(INVOICE_SETTING_KEYS.paymentDetails) ?? DEFAULT_INVOICE_SETTINGS.paymentDetails,
  }
}
```

If `server-only` breaks the Jest import, mirror how `src/lib/receiptSettings.ts` handles it (check its first lines) and copy that.

`src/lib/actions/invoiceSettings.ts`:

```ts
"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { assertNotDemo } from "@/lib/demoMode"
import { INVOICE_SETTING_KEYS, INVOICE_PAYMENT_DETAILS_MAX } from "@/lib/invoiceSettingsShared"

/** Save GST-registered flag and invoice payment details (ADMIN only). */
export async function updateInvoiceSettings(input: {
  gstRegistered: boolean
  paymentDetails: string
}): Promise<{ ok: true } | { error: string }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (typeof input.gstRegistered !== "boolean" || typeof input.paymentDetails !== "string") return { error: "Invalid settings" }
  const paymentDetails = input.paymentDetails.trim()
  if (paymentDetails.length > INVOICE_PAYMENT_DETAILS_MAX) {
    return { error: `Payment details must be ${INVOICE_PAYMENT_DETAILS_MAX} characters or fewer` }
  }
  const entries: [string, string][] = [
    [INVOICE_SETTING_KEYS.gstRegistered, String(input.gstRegistered)],
    [INVOICE_SETTING_KEYS.paymentDetails, paymentDetails],
  ]
  await prisma.$transaction(
    entries.map(([key, value]) => prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })),
  )
  await logAudit(actorId(session), "INVOICE_SETTINGS_UPDATED", "AppSetting", undefined, { gstRegistered: input.gstRegistered })
  revalidatePath("/accounting/settings")
  revalidatePath("/accounting/invoices")
  return { ok: true }
}
```

`src/components/accounting/InvoiceSettingsForm.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { updateInvoiceSettings } from "@/lib/actions/invoiceSettings"
import { INVOICE_PAYMENT_DETAILS_MAX, type InvoiceSettings } from "@/lib/invoiceSettingsShared"

/** Accounting-settings card: GST registration toggle + payment details printed on invoices. */
export function InvoiceSettingsForm({ initial }: Readonly<{ initial: InvoiceSettings }>) {
  const [gst, setGst] = useState(initial.gstRegistered)
  const [details, setDetails] = useState(initial.paymentDetails)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  function save() {
    start(async () => {
      const res = await updateInvoiceSettings({ gstRegistered: gst, paymentDetails: details })
      setMsg("error" in res ? { ok: false, text: res.error } : { ok: true, text: "Saved" })
    })
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} />
        The church is registered for GST (invoices become Tax Invoices with GST)
      </label>
      <div className="space-y-1">
        <Label htmlFor="invoicePaymentDetails">Payment details on invoices</Label>
        <Textarea id="invoicePaymentDetails" value={details} maxLength={INVOICE_PAYMENT_DETAILS_MAX}
          onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="Bank transfer: BSB 000-000, Account 00000000, Ref: invoice number" />
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{msg.text}</p>}
      </div>
    </div>
  )
}
```

In `src/app/(dashboard)/accounting/settings/page.tsx`: `const invoiceSettings = await getInvoiceSettings()` and add a card using the page's existing card markup:

```tsx
<section className="bg-card rounded-lg border border-border p-6 space-y-3">
  <h3 className="text-lg font-semibold">Invoices</h3>
  <InvoiceSettingsForm initial={invoiceSettings} />
</section>
```

- [ ] **Step 4: Run — expect PASS.** Also `npm test -- --testPathPatterns="accounting/settings"` if a page test exists; update its mocks to stub `@/lib/invoiceSettings`.

- [ ] **Step 5: Commit** — `git commit -m "feat(invoices): add GST and payment-details settings"`

---

### Task 4: Customers (actions + page)

**Files:**
- Create: `src/lib/actions/customer.ts`, `src/components/accounting/CustomerForm.tsx`, `src/app/(dashboard)/accounting/customers/page.tsx`, `src/app/(dashboard)/accounting/customers/new/page.tsx`, `src/app/(dashboard)/accounting/customers/[id]/edit/page.tsx`
- Test: `src/lib/actions/__tests__/customer.test.ts`

**Interfaces:**
- Produces:
  - `createCustomer(_prev: ActionResult, formData: FormData): Promise<ActionResult>` (redirects to list on success)
  - `updateCustomer(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult>`
  - `setCustomerActive(id: number, isActive: boolean): Promise<{ error: string } | { success: string }>`
  - `createCustomerInline(input: { name: string; email: string; address: string }): Promise<{ id: number; name: string } | { error: string }>` (used by RecipientPicker, Task 6)
  - `type CustomerView = { id: number; name: string; abn: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null; isActive: boolean }`
  - `listCustomers(opts?: { includeInactive?: boolean }): Promise<CustomerView[] | { error: string }>` — contact fields `null` for AUDITOR
  - `getCustomerForEdit(id: number): Promise<CustomerView | null>` (canAccessAccounting only)

- [ ] **Step 1: Failing tests** — `src/lib/actions/__tests__/customer.test.ts`:

```ts
import { createCustomer, updateCustomer, setCustomerActive, createCustomerInline, listCustomers } from "@/lib/actions/customer"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { redirect } from "next/navigation"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: { customer: { create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() } },
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
function fd(o: Record<string, string> = {}) {
  const f = new FormData()
  for (const [k, v] of Object.entries({ name: "Example Scouts", abn: "", email: "scouts@example.com", phone: "", address: "1 Example St", notes: "", ...o })) f.set(k, v)
  return f
}
beforeEach(() => { jest.clearAllMocks(); as("ADMIN"); (prisma.customer.create as jest.Mock).mockResolvedValue({ id: 9, name: "Example Scouts" }) })

describe("createCustomer", () => {
  it.each(["OFFICE_ADMIN", "AUDITOR", "VIEWER"])("rejects %s", async (r) => {
    as(r); expect(await createCustomer(undefined, fd())).toEqual({ error: "Unauthorized" })
  })
  it("encrypts contact fields, audits without PII, redirects", async () => {
    await createCustomer(undefined, fd())
    expect(prisma.customer.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      name: "Example Scouts", email: "enc:scouts@example.com", address: "enc:1 Example St", phone: null, notes: null, abn: null,
    }) })
    expect(logAudit).toHaveBeenCalledWith(1, "CUSTOMER_CREATED", "Customer", 9, {})
    expect(redirect).toHaveBeenCalledWith("/accounting/customers")
  })
  it("requires a name", async () => expect(await createCustomer(undefined, fd({ name: " " }))).toEqual({ error: "Name is required" }))
  it("validates email", async () => expect(await createCustomer(undefined, fd({ email: "x" }))).toEqual({ error: "Enter a valid email" }))
  it("validates ABN as 11 digits", async () => expect(await createCustomer(undefined, fd({ abn: "123" }))).toEqual({ error: "ABN must be 11 digits" }))
})

describe("updateCustomer / setCustomerActive", () => {
  it("updates and audits", async () => {
    ;(prisma.customer.update as jest.Mock).mockResolvedValue({ id: 9 })
    await updateCustomer(9, undefined, fd({ name: "Renamed" }))
    expect(prisma.customer.update).toHaveBeenCalledWith({ where: { id: 9 }, data: expect.objectContaining({ name: "Renamed" }) })
    expect(logAudit).toHaveBeenCalledWith(1, "CUSTOMER_UPDATED", "Customer", 9, {})
  })
  it("deactivates", async () => {
    ;(prisma.customer.update as jest.Mock).mockResolvedValue({ id: 9 })
    expect(await setCustomerActive(9, false)).toEqual({ success: "Customer deactivated" })
    expect(logAudit).toHaveBeenCalledWith(1, "CUSTOMER_ACTIVE_SET", "Customer", 9, { isActive: false })
  })
})

describe("createCustomerInline", () => {
  it("returns id and name", async () => {
    expect(await createCustomerInline({ name: "Example Scouts", email: "", address: "" })).toEqual({ id: 9, name: "Example Scouts" })
  })
  it("rejects AUDITOR", async () => { as("AUDITOR"); expect(await createCustomerInline({ name: "x", email: "", address: "" })).toEqual({ error: "Unauthorized" }) })
})

describe("listCustomers", () => {
  const row = { id: 9, name: "Example Scouts", abn: null, email: "enc:scouts@example.com", phone: null, address: "enc:1 Example St", notes: null, isActive: true }
  beforeEach(() => (prisma.customer.findMany as jest.Mock).mockResolvedValue([row]))
  it("decrypts for OFFICE_ADMIN", async () => {
    as("OFFICE_ADMIN"); expect(await listCustomers()).toEqual([expect.objectContaining({ email: "scouts@example.com", address: "1 Example St" })])
  })
  it("masks contact for AUDITOR", async () => {
    as("AUDITOR"); expect(await listCustomers()).toEqual([expect.objectContaining({ name: "Example Scouts", email: null, address: null, notes: null })])
  })
  it("rejects VIEWER", async () => { as("VIEWER"); expect(await listCustomers()).toEqual({ error: "Unauthorized" }) })
})
```

- [ ] **Step 2: Run — expect FAIL.** `npm test -- --testPathPatterns="actions/__tests__/customer"`

- [ ] **Step 3: Implement `src/lib/actions/customer.ts`**

```ts
"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { isValidEmail } from "@/lib/validation"
import { UserRole } from "@/lib/generated/prisma/enums"
import type { ActionResult } from "./types"

const LIST_PATH = "/accounting/customers"

export type CustomerView = {
  id: number; name: string; abn: string | null; email: string | null; phone: string | null
  address: string | null; notes: string | null; isActive: boolean
}

const CustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  abn: z.string().trim().transform((v) => v.replace(/\s/g, "")).refine((v) => v === "" || /^\d{11}$/.test(v), "ABN must be 11 digits"),
  email: z.string().trim().max(254).refine((v) => v === "" || isValidEmail(v), "Enter a valid email"),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(500),
  notes: z.string().trim().max(2000),
})

const encOrNull = (v: string) => (v === "" ? null : encrypt(v))
const decOrNull = (v: string | null) => (v ? safeDecrypt(v) : null)

/** Validate customer form fields and return the encrypted Prisma payload. */
function parseCustomer(formData: FormData): { data: { name: string; abn: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null } } | { error: string } {
  const get = (k: string) => String(formData.get(k) ?? "")
  const p = CustomerSchema.safeParse({ name: get("name"), abn: get("abn"), email: get("email"), phone: get("phone"), address: get("address"), notes: get("notes") })
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid customer" }
  const d = p.data
  return { data: { name: d.name, abn: d.abn || null, email: encOrNull(d.email), phone: encOrNull(d.phone), address: encOrNull(d.address), notes: encOrNull(d.notes) } }
}

/** Create a saved outside customer (ADMIN | PASTOR). */
export async function createCustomer(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = parseCustomer(formData)
  if ("error" in parsed) return parsed
  const row = await prisma.customer.create({ data: parsed.data })
  await logAudit(actorId(session), "CUSTOMER_CREATED", "Customer", row.id, {})
  revalidatePath(LIST_PATH)
  redirect(LIST_PATH)
}

/** Update a customer's details (ADMIN | PASTOR). Existing invoices keep their recipient snapshot. */
export async function updateCustomer(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = parseCustomer(formData)
  if ("error" in parsed) return parsed
  try {
    await prisma.customer.update({ where: { id }, data: parsed.data })
  } catch {
    return { error: "Customer not found" }
  }
  await logAudit(actorId(session), "CUSTOMER_UPDATED", "Customer", id, {})
  revalidatePath(LIST_PATH)
  redirect(LIST_PATH)
}

/** Activate/deactivate a customer. Customers are never hard-deleted (invoices reference them). */
export async function setCustomerActive(id: number, isActive: boolean): Promise<{ error: string } | { success: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  try {
    await prisma.customer.update({ where: { id }, data: { isActive } })
  } catch {
    return { error: "Customer not found" }
  }
  await logAudit(actorId(session), "CUSTOMER_ACTIVE_SET", "Customer", id, { isActive })
  revalidatePath(LIST_PATH)
  return { success: isActive ? "Customer reactivated" : "Customer deactivated" }
}

/** Quick-create from the invoice recipient picker; returns the new id + name. */
export async function createCustomerInline(input: { name: string; email: string; address: string }): Promise<{ id: number; name: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const f = new FormData()
  f.set("name", input.name ?? ""); f.set("email", input.email ?? ""); f.set("address", input.address ?? "")
  const parsed = parseCustomer(f)
  if ("error" in parsed) return parsed
  const row = await prisma.customer.create({ data: parsed.data })
  await logAudit(actorId(session), "CUSTOMER_CREATED", "Customer", row.id, { inline: true })
  revalidatePath(LIST_PATH)
  return { id: row.id, name: row.name }
}

/** List customers for accounting viewers; AUDITOR gets names only (contact fields null, never decrypted). */
export async function listCustomers(opts: { includeInactive?: boolean } = {}): Promise<CustomerView[] | { error: string }> {
  const session = await auth()
  const role = session?.user?.role
  if (!canViewAccounting(role)) return { error: "Unauthorized" }
  const rows = await prisma.customer.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
  })
  const masked = role === UserRole.AUDITOR
  return rows.map((r) => ({
    id: r.id, name: r.name, abn: r.abn, isActive: r.isActive,
    email: masked ? null : decOrNull(r.email),
    phone: masked ? null : decOrNull(r.phone),
    address: masked ? null : decOrNull(r.address),
    notes: masked ? null : decOrNull(r.notes),
  }))
}

/** Load one customer decrypted for the edit form (ADMIN | PASTOR). */
export async function getCustomerForEdit(id: number): Promise<CustomerView | null> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return null
  const r = await prisma.customer.findUnique({ where: { id } })
  if (!r) return null
  return { id: r.id, name: r.name, abn: r.abn, isActive: r.isActive, email: decOrNull(r.email), phone: decOrNull(r.phone), address: decOrNull(r.address), notes: decOrNull(r.notes) }
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: UI.** `src/components/accounting/CustomerForm.tsx` (client, `useActionState`, same structure as `DgrReceiptForm`):

```tsx
"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createCustomer, updateCustomer, type CustomerView } from "@/lib/actions/customer"

/** Create/edit form for a saved outside customer. */
export default function CustomerForm({ edit }: Readonly<{ edit?: CustomerView }>) {
  const action = edit ? updateCustomer.bind(null, edit.id) : createCustomer
  const [state, formAction, isPending] = useActionState(action, undefined)
  const field = (name: keyof CustomerView, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={(edit?.[name] as string | null) ?? ""} />
    </div>
  )
  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {field("name", "Name")}
      {field("abn", "ABN (optional)")}
      {field("email", "Email", "email")}
      {field("phone", "Phone")}
      <div className="space-y-1">
        <Label htmlFor="address">Address</Label>
        <Textarea id="address" name="address" rows={3} defaultValue={edit?.address ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={edit?.notes ?? ""} />
      </div>
      <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save customer"}</Button>
    </form>
  )
}
```

Pages (server components; pattern from `dgr-receipts/page.tsx`):
- `customers/page.tsx`: `canViewAccounting` else `redirect("/")`; `listCustomers({ includeInactive: true })`; table Name / Email / Phone / Status; for `canAccessAccounting` an "Edit" link and a client `CustomerActiveToggle` button calling `setCustomerActive` (inline small client component in the same folder, `"use client"`, `useTransition`, `router.refresh()` after). "New customer" button when `canAccessAccounting`.
- `customers/new/page.tsx`: `canAccessAccounting` else `redirect("/accounting/customers")`; renders `<CustomerForm />`.
- `customers/[id]/edit/page.tsx`: `canAccessAccounting`; `parseRouteId`; `getCustomerForEdit`; `notFound()` if null; renders `<CustomerForm edit={c} />`.

- [ ] **Step 6: Page test** — `src/app/(dashboard)/accounting/customers/__tests__/page.test.tsx`: mock `@/auth` and `@/lib/actions/customer`; assert VIEWER redirects, AUDITOR sees name but no email text and no "New customer" button, ADMIN sees button. Copy structure from `dgr-receipts/__tests__/page.test.tsx`.

- [ ] **Step 7: Run tests and lint** — `npm test -- --testPathPatterns="customer" && npx eslint src/lib/actions/customer.ts src/components/accounting/CustomerForm.tsx "src/app/(dashboard)/accounting/customers"`

- [ ] **Step 8: Commit** — `git commit -m "feat(invoices): add customers"`

---

### Task 5: Invoice draft actions and reads

**Files:**
- Create: `src/lib/actions/invoice.ts`
- Test: `src/lib/actions/__tests__/invoice.test.ts`

**Interfaces:**
- Consumes: `parseInvoiceDraft`, `computeInvoiceTotals`, `centsToDecimalString`, `InvoiceLine` (Task 2); `getInvoiceSettings` (Task 3).
- Produces:
  - `createInvoice(_prev: ActionResult, formData: FormData): Promise<ActionResult>` → redirect `/accounting/invoices/<id>`
  - `updateInvoice(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult>` (DRAFT only)
  - `deleteDraftInvoice(id: number): Promise<{ error: string } | { success: string }>`
  - `type InvoiceView = { id; invoiceNo: string | null; status: InvoiceStatus; personId: number | null; customerId: number | null; recipientName: string; recipientEmail: string | null; recipientAddress: string | null; issueDate: string; dueDate: string; lines: InvoiceLine[]; subtotal: string; gstTotal: string; total: string; taxInvoice: boolean; accountId: number; accountName: string; fundId: number | null; fundName: string | null; notes: string | null; sentAt: Date | null; paidAt: Date | null; voidedAt: Date | null; voidReason: string | null; paymentTransactionId: number | null }`
  - `getInvoice(id: number): Promise<InvoiceView | null | { error: string }>` — contact + notes `null` for AUDITOR
  - `listInvoices(filter: { status?: InvoiceStatus; from?: string; to?: string }): Promise<InvoiceListRow[] | { error: string }>` where `type InvoiceListRow = { id; invoiceNo: string | null; status: InvoiceStatus; recipientName: string; issueDate: string; dueDate: string; total: string; gstTotal: string; paidAt: Date | null }`
  - `getRecipientContact(kind: "person" | "customer", id: number): Promise<{ email: string; address: string } | { error: string }>` (ADMIN | PASTOR)
  - helper (module-private) `toDraftData(d: InvoiceDraftInput, gstEnabled: boolean)`

- [ ] **Step 1: Failing tests** — `src/lib/actions/__tests__/invoice.test.ts`:

```ts
import { createInvoice, updateInvoice, deleteDraftInvoice, getInvoice, getRecipientContact } from "@/lib/actions/invoice"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { redirect } from "next/navigation"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn(async () => ({ gstRegistered: true, paymentDetails: "" })) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    account: { findUnique: jest.fn() },
    fund: { findUnique: jest.fn() },
    person: { findUnique: jest.fn() },
    customer: { findUnique: jest.fn() },
  },
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
function fd(o: Record<string, string> = {}) {
  const f = new FormData()
  const base: Record<string, string> = {
    recipientKind: "customer", recipientId: "3", recipientName: "Example Scouts", recipientEmail: "scouts@example.com",
    recipientAddress: "1 Example St", issueDate: "2026-10-11", dueDate: "2026-10-25", accountId: "4", fundId: "", notes: "",
    lines: JSON.stringify([{ description: "Hall hire", qty: "2", unitPrice: "150.00", gst: true }]), ...o,
  }
  for (const [k, v] of Object.entries(base)) f.set(k, v)
  return f
}
beforeEach(() => {
  jest.clearAllMocks(); as("ADMIN")
  ;(prisma.account.findUnique as jest.Mock).mockResolvedValue({ id: 4, type: "INCOME", isActive: true })
  ;(prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 3, isActive: true })
  ;(prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 11 })
  ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
})

describe("createInvoice", () => {
  it.each(["OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER"])("rejects %s", async (r) => {
    as(r); expect(await createInvoice(undefined, fd())).toEqual({ error: "Unauthorized" })
  })
  it("computes totals server-side, encrypts contact, audits, redirects", async () => {
    await createInvoice(undefined, fd())
    expect(prisma.invoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: "DRAFT", customerId: 3, personId: null, recipientName: "Example Scouts",
      recipientEmail: "enc:scouts@example.com", recipientAddress: "enc:1 Example St",
      subtotal: "300.00", gstTotal: "30.00", total: "330.00", accountId: 4, fundId: null, createdById: 1,
      lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }],
    }) })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_CREATED", "Invoice", 11, { total: "330.00" })
    expect(redirect).toHaveBeenCalledWith("/accounting/invoices/11")
  })
  it("ignores GST when not registered", async () => {
    const { getInvoiceSettings } = jest.requireMock("@/lib/invoiceSettings")
    getInvoiceSettings.mockResolvedValueOnce({ gstRegistered: false, paymentDetails: "" })
    await createInvoice(undefined, fd())
    expect(prisma.invoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({ gstTotal: "0.00", total: "300.00" }) })
  })
  it("rejects a non-income or inactive account", async () => {
    ;(prisma.account.findUnique as jest.Mock).mockResolvedValue({ id: 4, type: "EXPENSE", isActive: true })
    expect(await createInvoice(undefined, fd())).toEqual({ error: "Choose an active income account" })
  })
  it("rejects an unknown customer", async () => {
    ;(prisma.customer.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await createInvoice(undefined, fd())).toEqual({ error: "Recipient not found" })
  })
  it("rejects a missing person", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await createInvoice(undefined, fd({ recipientKind: "person", recipientId: "5" }))).toEqual({ error: "Recipient not found" })
  })
  it("rejects an inactive fund", async () => {
    ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, isActive: false })
    expect(await createInvoice(undefined, fd({ fundId: "2" }))).toEqual({ error: "Choose an active fund" })
  })
})

describe("updateInvoice", () => {
  it("only updates drafts", async () => {
    ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await updateInvoice(11, undefined, fd())).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11, status: "DRAFT" } }))
  })
  it("audits on success", async () => {
    await updateInvoice(11, undefined, fd())
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_UPDATED", "Invoice", 11, { total: "330.00" })
  })
})

describe("deleteDraftInvoice", () => {
  it("deletes only drafts", async () => {
    ;(prisma.invoice.deleteMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await deleteDraftInvoice(11)).toEqual({ error: "Only unnumbered draft invoices can be deleted" })
    expect(prisma.invoice.deleteMany).toHaveBeenCalledWith({ where: { id: 11, status: "DRAFT", invoiceNo: null } })
  })
})

describe("getInvoice", () => {
  const row = {
    id: 11, invoiceNo: null, status: "DRAFT", personId: null, customerId: 3, recipientName: "Example Scouts",
    recipientEmail: "enc:scouts@example.com", recipientAddress: "enc:1 Example St",
    issueDate: new Date("2026-10-11"), dueDate: new Date("2026-10-25"),
    lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }],
    subtotal: { toString: () => "300.00" }, gstTotal: { toString: () => "30.00" }, total: { toString: () => "330.00" },
    taxInvoice: false, accountId: 4, account: { name: "Hall hire" }, fundId: null, fund: null, notes: "enc:n",
    sentAt: null, paidAt: null, voidedAt: null, voidReason: null, payment: null,
  }
  beforeEach(() => (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(row))
  it("decrypts for OFFICE_ADMIN", async () => {
    as("OFFICE_ADMIN")
    expect(await getInvoice(11)).toEqual(expect.objectContaining({ recipientEmail: "scouts@example.com", notes: "n", issueDate: "2026-10-11", total: "330.00" }))
  })
  it("masks for AUDITOR", async () => {
    as("AUDITOR")
    expect(await getInvoice(11)).toEqual(expect.objectContaining({ recipientName: "Example Scouts", recipientEmail: null, recipientAddress: null, notes: null }))
  })
  it("rejects VIEWER", async () => { as("VIEWER"); expect(await getInvoice(11)).toEqual({ error: "Unauthorized" }) })
})

describe("getRecipientContact", () => {
  it("builds a person's address from their family", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({
      email: "enc:p@example.com", family: { address: "enc:2 Example Rd", suburb: "enc:Exampleton", state: "enc:NSW", postcode: "enc:2000" },
    })
    expect(await getRecipientContact("person", 5)).toEqual({ email: "p@example.com", address: "2 Example Rd\nExampleton NSW 2000" })
  })
  it("rejects AUDITOR", async () => { as("AUDITOR"); expect(await getRecipientContact("person", 5)).toEqual({ error: "Unauthorized" }) })
})
```

- [ ] **Step 2: Run — expect FAIL.** `npm test -- --testPathPatterns="actions/__tests__/invoice.test"`

- [ ] **Step 3: Implement `src/lib/actions/invoice.ts`**

```ts
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

export const INVOICES_PATH = "/accounting/invoices"
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
const encOrNull = (v: string) => (v === "" ? null : encrypt(v))
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
```

- [ ] **Step 4: Run — expect PASS.** Then `npx tsc --noEmit -p .` for the touched files' types (Prisma generated types).

- [ ] **Step 5: Commit** — `git commit -m "feat(invoices): add draft invoice actions"`

---

### Task 6: Invoice UI — recipient picker, form, list, detail pages

**Files:**
- Create: `src/components/accounting/RecipientPicker.tsx`, `src/components/accounting/InvoiceForm.tsx`, `src/components/accounting/InvoiceStatusBadge.tsx`
- Create: `src/app/(dashboard)/accounting/invoices/page.tsx`, `.../invoices/loading.tsx`, `.../invoices/new/page.tsx`, `.../invoices/[id]/page.tsx`, `.../invoices/[id]/edit/page.tsx`
- Test: `src/components/accounting/__tests__/InvoiceForm.test.tsx`, `src/app/(dashboard)/accounting/invoices/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: Task 4 `createCustomerInline`; Task 5 `createInvoice`, `updateInvoice`, `deleteDraftInvoice`, `getInvoice`, `listInvoices`, `getRecipientContact`, `InvoiceView`; Task 2 `computeInvoiceTotals`.
- Produces:
  - `type RecipientOption = { kind: "person" | "customer"; id: number; name: string }`
  - `RecipientPicker` props `{ options: RecipientOption[]; value: { kind: "person" | "customer" | "none"; id: number | null; name: string }; onPick(o: RecipientOption | null): void; onCreated(o: RecipientOption): void }`
  - `InvoiceForm` default export, props `{ recipients: RecipientOption[]; accounts: { id: number; name: string }[]; funds: { id: number; name: string }[]; gstEnabled: boolean; edit?: InvoiceView }`
  - `InvoiceStatusBadge({ status })`

- [ ] **Step 1: Failing component test** — `src/components/accounting/__tests__/InvoiceForm.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react"
import InvoiceForm from "@/components/accounting/InvoiceForm"

jest.mock("@/lib/actions/invoice", () => ({ createInvoice: jest.fn(), updateInvoice: jest.fn(), getRecipientContact: jest.fn() }))
jest.mock("@/lib/actions/customer", () => ({ createCustomerInline: jest.fn() }))

const props = {
  recipients: [{ kind: "customer" as const, id: 3, name: "Example Scouts" }],
  accounts: [{ id: 4, name: "Hall hire" }], funds: [], gstEnabled: true,
}

describe("InvoiceForm", () => {
  it("shows live totals with GST", () => {
    render(<InvoiceForm {...props} />)
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Hall hire" } })
    fireEvent.change(screen.getByLabelText("Line 1 quantity"), { target: { value: "2" } })
    fireEvent.change(screen.getByLabelText("Line 1 unit price"), { target: { value: "150" } })
    expect(screen.getByTestId("invoice-subtotal")).toHaveTextContent("$300.00")
    expect(screen.getByTestId("invoice-gst")).toHaveTextContent("$30.00")
    expect(screen.getByTestId("invoice-total")).toHaveTextContent("$330.00")
  })
  it("hides GST controls when not registered", () => {
    render(<InvoiceForm {...props} gstEnabled={false} />)
    expect(screen.queryByLabelText("Line 1 GST")).not.toBeInTheDocument()
    expect(screen.queryByTestId("invoice-gst")).not.toBeInTheDocument()
  })
  it("adds and removes lines", () => {
    render(<InvoiceForm {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Add line" }))
    expect(screen.getByLabelText("Line 2 description")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remove line 2" }))
    expect(screen.queryByLabelText("Line 2 description")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `InvoiceStatusBadge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge"
import type { InvoiceStatus } from "@/lib/generated/prisma/enums"

const LABEL: Record<InvoiceStatus, string> = { DRAFT: "Draft", SENT: "Sent", PAID: "Paid", VOID: "Void" }
const VARIANT: Record<InvoiceStatus, "secondary" | "default" | "outline" | "destructive"> = {
  DRAFT: "secondary", SENT: "default", PAID: "outline", VOID: "destructive",
}

/** Coloured status pill for an invoice. */
export function InvoiceStatusBadge({ status }: Readonly<{ status: InvoiceStatus }>) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>
}
```

(Check `src/components/ui/badge.tsx` variant names; adjust to what exists.)

- [ ] **Step 4: Implement `RecipientPicker.tsx`** — Popover + Command, pattern from `DgrReceiptForm`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { createCustomerInline } from "@/lib/actions/customer"

export type RecipientOption = { kind: "person" | "customer"; id: number; name: string }
type Value = { kind: "person" | "customer" | "none"; id: number | null; name: string }

/** Searchable picker over members and saved customers, with inline "+ New customer". */
export function RecipientPicker({ options, value, onPick, onCreated }: Readonly<{
  options: RecipientOption[]; value: Value; onPick: (o: RecipientOption | null) => void; onCreated: (o: RecipientOption) => void
}>) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: "", email: "", address: "" })
  const [err, setErr] = useState<string | null>(null)
  const people = options.filter((o) => o.kind === "person")
  const customers = options.filter((o) => o.kind === "customer")

  async function create() {
    setErr(null)
    const res = await createCustomerInline(draft)
    if ("error" in res) { setErr(res.error); return }
    const opt: RecipientOption = { kind: "customer", id: res.id, name: res.name }
    onCreated(opt)
    setCreating(false); setOpen(false); setDraft({ name: "", email: "", address: "" })
  }

  const item = (o: RecipientOption) => (
    <CommandItem key={`${o.kind}-${o.id}`} value={`${o.name}\u0000${o.kind}${o.id}`} onSelect={() => { onPick(o); setOpen(false) }}>
      {o.name}
    </CommandItem>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label="Choose recipient" className="w-full justify-start">
          {value.kind === "none" ? "Pick a member or customer (optional)" : value.name}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] p-0">
        {creating ? (
          <div className="space-y-2 p-3">
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            <Input aria-label="New customer name" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Input aria-label="New customer email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <Input aria-label="New customer address" placeholder="Address" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={create}>Save customer</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Command>
            <CommandInput placeholder="Search people and customers…" />
            <CommandList>
              <CommandEmpty>No match.</CommandEmpty>
              {customers.length > 0 && <CommandGroup heading="Customers">{customers.map(item)}</CommandGroup>}
              {people.length > 0 && <CommandGroup heading="People">{people.map(item)}</CommandGroup>}
              <CommandGroup>
                <CommandItem value="__new_customer" onSelect={() => setCreating(true)}>+ New customer</CommandItem>
                {value.kind !== "none" && <CommandItem value="__clear" onSelect={() => { onPick(null); setOpen(false) }}>Clear (type recipient manually)</CommandItem>}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 5: Implement `InvoiceForm.tsx`**

```tsx
"use client"

import { useActionState, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createInvoice, updateInvoice, getRecipientContact, type InvoiceView } from "@/lib/actions/invoice"
import { computeInvoiceTotals, INVOICE_MAX_LINES } from "@/lib/invoice"
import { toCents, fmtAUD, centsToNumber } from "@/lib/formatting"
import { sydneyTodayYMD } from "@/lib/dates"
import { RecipientPicker, type RecipientOption } from "./RecipientPicker"

type LineState = { description: string; qty: string; unitPrice: string; gst: boolean }
const blank = (gst: boolean): LineState => ({ description: "", qty: "1", unitPrice: "", gst })

/** Draft invoice editor with recipient picker, line items and live (display-only) totals. */
export default function InvoiceForm({ recipients, accounts, funds, gstEnabled, edit }: Readonly<{
  recipients: RecipientOption[]; accounts: { id: number; name: string }[]; funds: { id: number; name: string }[]
  gstEnabled: boolean; edit?: InvoiceView
}>) {
  const action = edit ? updateInvoice.bind(null, edit.id) : createInvoice
  const [state, formAction, isPending] = useActionState(action, undefined)
  const [options, setOptions] = useState(recipients)
  const initialKind = edit ? (edit.personId ? "person" : edit.customerId ? "customer" : "none") : "none"
  const [recipient, setRecipient] = useState<{ kind: "person" | "customer" | "none"; id: number | null; name: string }>({
    kind: initialKind, id: edit?.personId ?? edit?.customerId ?? null, name: edit?.recipientName ?? "",
  })
  const [name, setName] = useState(edit?.recipientName ?? "")
  const [email, setEmail] = useState(edit?.recipientEmail ?? "")
  const [address, setAddress] = useState(edit?.recipientAddress ?? "")
  const [lines, setLines] = useState<LineState[]>(
    edit ? edit.lines.map((l) => ({ description: l.description, qty: String(l.qty), unitPrice: (l.unitPriceCents / 100).toFixed(2), gst: l.gst })) : [blank(gstEnabled)],
  )
  const reqId = useRef(0)
  const today = sydneyTodayYMD()

  async function pick(o: RecipientOption | null) {
    if (!o) { setRecipient({ kind: "none", id: null, name }); return }
    setRecipient({ kind: o.kind, id: o.id, name: o.name })
    setName(o.name)
    const my = ++reqId.current
    const res = await getRecipientContact(o.kind, o.id)
    if (my !== reqId.current || "error" in res) return
    setEmail(res.email); setAddress(res.address)
  }

  const totals = useMemo(() => {
    const parsed = lines.map((l) => {
      const qty = /^\d{1,4}$/.test(l.qty) ? Number.parseInt(l.qty, 10) : 0
      const c = toCents(l.unitPrice)
      return { description: l.description, qty, unitPriceCents: Number.isFinite(c) && c >= 0 ? c : 0, gst: l.gst }
    })
    return computeInvoiceTotals(parsed, gstEnabled)
  }, [lines, gstEnabled])

  const setLine = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const serialized = JSON.stringify(lines.map((l) => ({ ...l, gst: gstEnabled && l.gst })))

  return (
    <form action={formAction} className="max-w-3xl space-y-5">
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <input type="hidden" name="recipientKind" value={recipient.kind} />
      <input type="hidden" name="recipientId" value={recipient.id ?? ""} />
      <input type="hidden" name="lines" value={serialized} />

      <fieldset className="space-y-3">
        <legend className="font-medium">Recipient</legend>
        <RecipientPicker options={options} value={recipient} onPick={pick}
          onCreated={(o) => { setOptions((xs) => [...xs, o]); void pick(o) }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="recipientName">Name</Label>
            <Input id="recipientName" name="recipientName" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="space-y-1"><Label htmlFor="recipientEmail">Email</Label>
            <Input id="recipientEmail" name="recipientEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="recipientAddress">Address</Label>
          <Textarea id="recipientAddress" name="recipientAddress" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="issueDate">Issue date</Label>
          <Input id="issueDate" name="issueDate" type="date" defaultValue={edit?.issueDate ?? today} required /></div>
        <div className="space-y-1"><Label htmlFor="dueDate">Due date</Label>
          <Input id="dueDate" name="dueDate" type="date" defaultValue={edit?.dueDate ?? today} required /></div>
        <div className="space-y-1"><Label htmlFor="accountId">Income account</Label>
          <select id="accountId" name="accountId" defaultValue={edit?.accountId ?? ""} required className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="" disabled>Choose…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
        <div className="space-y-1"><Label htmlFor="fundId">Fund (optional)</Label>
          <select id="fundId" name="fundId" defaultValue={edit?.fundId ?? ""} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="">None</option>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></div>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium">Lines {gstEnabled && <span className="text-sm text-muted-foreground">(prices exclude GST)</span>}</legend>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2">
            <Input className="col-span-6" aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
            <Input className="col-span-2" aria-label={`Line ${i + 1} quantity`} inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
            <Input className="col-span-2" aria-label={`Line ${i + 1} unit price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
            {gstEnabled && (
              <label className="col-span-1 flex items-center gap-1 text-sm">
                <input type="checkbox" aria-label={`Line ${i + 1} GST`} checked={l.gst} onChange={(e) => setLine(i, { gst: e.target.checked })} /> GST
              </label>
            )}
            <Button type="button" variant="ghost" size="sm" className="col-span-1" aria-label={`Remove line ${i + 1}`}
              disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={lines.length >= INVOICE_MAX_LINES}
          onClick={() => setLines((ls) => [...ls, blank(gstEnabled)])}>Add line</Button>
      </fieldset>

      <dl className="ml-auto w-64 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd data-testid="invoice-subtotal">{fmtAUD(centsToNumber(totals.subtotalCents))}</dd></div>
        {gstEnabled && <div className="flex justify-between"><dt>GST</dt><dd data-testid="invoice-gst">{fmtAUD(centsToNumber(totals.gstCents))}</dd></div>}
        <div className="flex justify-between font-semibold"><dt>Total</dt><dd data-testid="invoice-total">{fmtAUD(centsToNumber(totals.totalCents))}</dd></div>
      </dl>

      <div className="space-y-1"><Label htmlFor="notes">Notes (printed on the invoice)</Label>
        <Textarea id="notes" name="notes" rows={2} defaultValue={edit?.notes ?? ""} /></div>

      <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save draft"}</Button>
    </form>
  )
}
```

Confirm `fmtAUD` output format (e.g. `$300.00`) and adjust test strings if it differs.

- [ ] **Step 6: Run component test — expect PASS.**

- [ ] **Step 7: Pages**

`invoices/new/page.tsx` and `[id]/edit/page.tsx` (server): gate `canAccessAccounting` → `redirect("/accounting/invoices")`. Load:

```ts
const [people, customers, accounts, funds, settings] = await Promise.all([
  prisma.person.findMany({ where: { archivedAt: null }, select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: PERSON_PICKER_CAP }),
  prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  prisma.account.findMany({ where: { type: "INCOME", isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  prisma.fund.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  getInvoiceSettings(),
])
const recipients: RecipientOption[] = [
  ...customers.map((c) => ({ kind: "customer" as const, id: c.id, name: c.name })),
  ...people.map((p) => ({ kind: "person" as const, id: p.id, name: `${p.firstName} ${p.lastName}` })),
]
```

Edit page: `parseRouteId`; `getInvoice(id)`; if null / error / `status !== "DRAFT"` → `redirect(\`/accounting/invoices/${id}\`)`. Pass `edit={invoice}` and `gstEnabled={settings.gstRegistered}`. Account option label `${a.code} ${a.name}`.

`invoices/page.tsx` (server): gate `canViewAccounting`; `void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "Invoice", undefined, { report: "invoices" })`; GET-form filters `status` (All/Draft/Sent/Paid/Void) and `from`/`to` dates (validate with `isRealCalendarDate`, ignore otherwise); `listInvoices(...)`; table: Number (or "Draft"), Recipient, Issue date, Due date (red text when SENT and due < today Sydney), Total (`fmtAUD(centsToNumber(toCents(r.total)))`), `InvoiceStatusBadge`; each row links to detail. "New invoice" + "Customers" buttons when `canAccessAccounting` (Customers link for all viewers).

`invoices/[id]/page.tsx` (server): gate `canViewAccounting`; `getInvoice`; `notFound()` if null. Shows header (number/"Draft", badge), recipient block (contact hidden when null), dates, account/fund, lines table with per-line GST column when `taxInvoice || status === "DRAFT" && gstEnabled`, totals, notes, sent/paid/void timestamps. Action area:
- DRAFT + canAccessAccounting: "Edit" link, `DeleteDraftButton` (small client component in `src/components/accounting/InvoiceRowActions.tsx` calling `deleteDraftInvoice` then `router.push("/accounting/invoices")`; hidden when `invoiceNo` set). Send buttons come in Task 8.
- "Download PDF" link (`/accounting/invoices/${id}/pdf`) when role !== AUDITOR (route arrives in Task 7; add link now).

`loading.tsx`: copy `dgr-receipts/loading.tsx`.

- [ ] **Step 8: Page test** — `src/app/(dashboard)/accounting/invoices/__tests__/page.test.tsx`: mock `@/auth`, `@/lib/actions/invoice` (`listInvoices` → one row), `@/lib/audit`; assert VIEWER → `redirect("/")`; AUDITOR sees row but no "New invoice"; ADMIN sees "New invoice". Follow `dgr-receipts/__tests__/page.test.tsx`.

- [ ] **Step 9: Run tests + lint**

`npm test -- --testPathPatterns="InvoiceForm|accounting/invoices" && npx eslint src/components/accounting "src/app/(dashboard)/accounting/invoices"`

- [ ] **Step 10: Commit** — `git commit -m "feat(invoices): add invoice list, form and detail pages"`

---

### Task 7: Invoice PDF + download route

**Files:**
- Create: `src/lib/pdf/InvoicePdf.ts`, `src/lib/invoicePdfModel.ts`
- Create: `src/app/(dashboard)/accounting/invoices/[id]/pdf/route.ts`
- Test: `src/lib/pdf/__tests__/InvoicePdf.test.ts`, `src/lib/__tests__/invoicePdfModel.test.ts`, `src/app/(dashboard)/accounting/invoices/[id]/pdf/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `InvoiceLine`, `lineGstCents` (Task 2); `getInvoiceSettings` (Task 3); `getChurchSettingsStrict` (`@/lib/churchSettings`, returns `{ name, address, abn, email }`); `getLetterheadAsset` (`@/lib/branding`); `drawTextLetterhead(doc, name, address, x, top, width): number` (`@/lib/pdf/textLetterhead`).
- Produces:
  - `type InvoicePdfModel = { title: "Tax Invoice" | "Invoice"; draft: boolean; invoiceNo: string | null; issueDate: string; dueDate: string; church: { name: string; address: string; abn: string; email: string }; recipient: { name: string; email: string; address: string }; showGst: boolean; lines: { description: string; qty: number; unitPrice: string; gst: string; amount: string }[]; subtotal: string; gstTotal: string; total: string; notes: string; paymentDetails: string }`
  - `buildInvoicePdfModel(inv: { invoiceNo: string | null; status: InvoiceStatus; taxInvoice: boolean; issueDate: Date; dueDate: Date; recipientName: string; recipientEmail: string; recipientAddress: string; lines: InvoiceLine[]; subtotal: string; gstTotal: string; total: string; notes: string }, church: {...}, settings: InvoiceSettings): InvoicePdfModel`
  - `renderInvoicePdf(model: InvoicePdfModel): Promise<Buffer>`
  - `loadInvoicePdf(id: number): Promise<{ pdf: Buffer; filename: string; recipientEmail: string; invoiceNo: string | null; recipientName: string; total: string; dueDate: string } | null>` in `src/lib/invoicePdfModel.ts` (server-only loader reused by Task 8)

Rules: for DRAFT, `showGst = settings.gstRegistered`, `title` from the same; for others, `showGst = taxInvoice`, `title = taxInvoice ? "Tax Invoice" : "Invoice"`. Dates rendered `formatLongDate` (from `@/lib/formatting`, used by DGR). Money strings via `fmtAUD(centsToNumber(cents))`.

- [ ] **Step 1: Failing model test** — `src/lib/__tests__/invoicePdfModel.test.ts`:

```ts
import { buildInvoicePdfModel } from "@/lib/invoicePdfModel"

jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))

const church = { name: "Example Church", address: "1 Example St", abn: "51824753556", email: "church@example.com" }
const base = {
  invoiceNo: "INV-0001", status: "SENT" as const, taxInvoice: true, issueDate: new Date("2026-10-11"), dueDate: new Date("2026-10-25"),
  recipientName: "Example Scouts", recipientEmail: "scouts@example.com", recipientAddress: "1 Example St",
  lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }],
  subtotal: "300.00", gstTotal: "30.00", total: "330.00", notes: "",
}

describe("buildInvoicePdfModel", () => {
  it("tax invoice shows GST", () => {
    const m = buildInvoicePdfModel(base, church, { gstRegistered: false, paymentDetails: "BSB 000-000" })
    expect(m).toMatchObject({ title: "Tax Invoice", showGst: true, draft: false, invoiceNo: "INV-0001", paymentDetails: "BSB 000-000" })
    expect(m.lines[0]).toEqual({ description: "Hall hire", qty: 2, unitPrice: "$150.00", gst: "$30.00", amount: "$300.00" })
    expect(m.total).toBe("$330.00")
  })
  it("plain invoice hides GST", () => {
    expect(buildInvoicePdfModel({ ...base, taxInvoice: false }, church, { gstRegistered: true, paymentDetails: "" }))
      .toMatchObject({ title: "Invoice", showGst: false })
  })
  it("draft follows current settings", () => {
    expect(buildInvoicePdfModel({ ...base, status: "DRAFT", invoiceNo: null, taxInvoice: false }, church, { gstRegistered: true, paymentDetails: "" }))
      .toMatchObject({ draft: true, title: "Tax Invoice", showGst: true, invoiceNo: null })
  })
})
```

- [ ] **Step 2: Failing render test** — `src/lib/pdf/__tests__/InvoicePdf.test.ts` (mirror `renderDgrReceiptPdf.test.ts` mocks of `@/lib/branding`):

```ts
/** @jest-environment node */
import { renderInvoicePdf } from "@/lib/pdf/InvoicePdf"

jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn(async () => null) }))

const model = {
  title: "Tax Invoice" as const, draft: false, invoiceNo: "INV-0001", issueDate: "11 October 2026", dueDate: "25 October 2026",
  church: { name: "Example Church", address: "1 Example St", abn: "51824753556", email: "church@example.com" },
  recipient: { name: "Example Scouts", email: "scouts@example.com", address: "1 Example St" }, showGst: true,
  lines: [{ description: "Hall hire", qty: 2, unitPrice: "$150.00", gst: "$30.00", amount: "$300.00" }],
  subtotal: "$300.00", gstTotal: "$30.00", total: "$330.00", notes: "", paymentDetails: "BSB 000-000",
}

describe("renderInvoicePdf", () => {
  it.each([
    ["tax", model],
    ["plain", { ...model, title: "Invoice" as const, showGst: false }],
    ["draft", { ...model, draft: true, invoiceNo: null }],
    ["many lines", { ...model, lines: Array.from({ length: 50 }, () => model.lines[0]) }],
  ])("renders a %s invoice", async (_n, m) => {
    const pdf = await renderInvoicePdf(m)
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.length).toBeGreaterThan(1000)
  })
})
```

- [ ] **Step 3: Run both — expect FAIL.**

- [ ] **Step 4: Implement `src/lib/invoicePdfModel.ts`**

```ts
import "server-only"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { getChurchSettingsStrict } from "@/lib/churchSettings"
import { getInvoiceSettings, type InvoiceSettings } from "@/lib/invoiceSettings"
import { renderInvoicePdf } from "@/lib/pdf/InvoicePdf"
import { lineGstCents, type InvoiceLine } from "@/lib/invoice"
import { fmtAUD, centsToNumber, toCents, formatLongDate } from "@/lib/formatting"
import type { InvoiceStatus } from "@/lib/generated/prisma/enums"

type Church = { name: string; address: string; abn: string; email: string }
export type InvoicePdfModel = {
  title: "Tax Invoice" | "Invoice"; draft: boolean; invoiceNo: string | null; issueDate: string; dueDate: string
  church: Church; recipient: { name: string; email: string; address: string }; showGst: boolean
  lines: { description: string; qty: number; unitPrice: string; gst: string; amount: string }[]
  subtotal: string; gstTotal: string; total: string; notes: string; paymentDetails: string
}

const money = (cents: number) => fmtAUD(centsToNumber(cents))

/** Shape an invoice row into display strings for the PDF renderer (pure apart from formatting). */
export function buildInvoicePdfModel(inv: {
  invoiceNo: string | null; status: InvoiceStatus; taxInvoice: boolean; issueDate: Date; dueDate: Date
  recipientName: string; recipientEmail: string; recipientAddress: string; lines: InvoiceLine[]
  subtotal: string; gstTotal: string; total: string; notes: string
}, church: Church, settings: InvoiceSettings): InvoicePdfModel {
  const draft = inv.status === "DRAFT"
  const showGst = draft ? settings.gstRegistered : inv.taxInvoice
  return {
    title: showGst ? "Tax Invoice" : "Invoice",
    draft, invoiceNo: inv.invoiceNo,
    issueDate: formatLongDate(inv.issueDate), dueDate: formatLongDate(inv.dueDate),
    church,
    recipient: { name: inv.recipientName, email: inv.recipientEmail, address: inv.recipientAddress },
    showGst,
    lines: inv.lines.map((l) => ({
      description: l.description, qty: l.qty, unitPrice: money(l.unitPriceCents),
      gst: money(lineGstCents(l, showGst)), amount: money(l.qty * l.unitPriceCents),
    })),
    subtotal: money(toCents(inv.subtotal)), gstTotal: money(toCents(inv.gstTotal)), total: money(toCents(inv.total)),
    notes: inv.notes, paymentDetails: settings.paymentDetails,
  }
}

/** Load, decrypt and render an invoice PDF. Callers must have checked authorisation. */
export async function loadInvoicePdf(id: number) {
  const r = await prisma.invoice.findUnique({ where: { id } })
  if (!r) return null
  const recipientEmail = r.recipientEmail ? safeDecrypt(r.recipientEmail) : ""
  const [church, settings] = await Promise.all([getChurchSettingsStrict(), getInvoiceSettings()])
  const model = buildInvoicePdfModel({
    invoiceNo: r.invoiceNo, status: r.status, taxInvoice: r.taxInvoice, issueDate: r.issueDate, dueDate: r.dueDate,
    recipientName: r.recipientName, recipientEmail, recipientAddress: r.recipientAddress ? safeDecrypt(r.recipientAddress) : "",
    lines: r.lines as InvoiceLine[], subtotal: r.subtotal.toString(), gstTotal: r.gstTotal.toString(), total: r.total.toString(),
    notes: r.notes ? safeDecrypt(r.notes) : "",
  }, church, settings)
  const pdf = await renderInvoicePdf(model)
  return {
    pdf, filename: r.invoiceNo ? `${r.invoiceNo}.pdf` : `DRAFT-${r.id}.pdf`, recipientEmail,
    invoiceNo: r.invoiceNo, recipientName: r.recipientName, total: model.total, dueDate: model.dueDate,
  }
}
```

Check `formatLongDate` accepts a `Date` (DGR passes one); and `getChurchSettingsStrict` return shape — adapt the `Church` type to it.

- [ ] **Step 5: Implement `src/lib/pdf/InvoicePdf.ts`**

```ts
// Invoice PDF via PDFKit (same engine as DgrReceiptPdf — @react-pdf breaks under Jest).
import PDFDocument from "pdfkit"
import { getLetterheadAsset } from "@/lib/branding"
import { drawTextLetterhead } from "@/lib/pdf/textLetterhead"
import { PRIMARY_HEX, ACCENT_HEX, SLATE_700, SLATE_500, BORDER, LIGHT_BG } from "@/lib/theme/palette"
import type { InvoicePdfModel } from "@/lib/invoicePdfModel"

const MARGIN = 48
const LETTERHEAD_TOP = 40
const LETTERHEAD_MAX_H = 160
const FOOTER_H = 50
const ROW_H = 20

type Letterhead = Awaited<ReturnType<typeof getLetterheadAsset>>

/** Letterhead image (or text fallback) + title block; returns the Y where content starts. */
function drawHeader(doc: PDFKit.PDFDocument, m: InvoicePdfModel, lh: Letterhead, contentW: number): number {
  let y: number
  if (lh) {
    const h = Math.min(LETTERHEAD_MAX_H, contentW / lh.aspect)
    doc.image(lh.bytes, MARGIN, LETTERHEAD_TOP, { fit: [contentW, h], align: "center" })
    y = LETTERHEAD_TOP + h + 8
  } else {
    y = drawTextLetterhead(doc, m.church.name, m.church.address, MARGIN, LETTERHEAD_TOP, contentW) + 8
  }
  doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).strokeColor(ACCENT_HEX).lineWidth(1.5).stroke()
  y += 14
  doc.fillColor(PRIMARY_HEX).font("Helvetica-Bold").fontSize(20).text(m.title.toUpperCase(), MARGIN, y)
  if (m.showGst && m.church.abn) doc.font("Helvetica").fontSize(10).fillColor(SLATE_700).text(`ABN ${m.church.abn}`, MARGIN, y + 4, { width: contentW, align: "right" })
  return y + 34
}

/** Recipient (left) and invoice meta (right). */
function drawParties(doc: PDFKit.PDFDocument, m: InvoicePdfModel, y: number, contentW: number): number {
  const half = contentW / 2
  doc.font("Helvetica-Bold").fontSize(9).fillColor(SLATE_500).text("BILL TO", MARGIN, y)
  doc.font("Helvetica").fontSize(11).fillColor(SLATE_700)
    .text([m.recipient.name, m.recipient.address, m.recipient.email].filter(Boolean).join("\n"), MARGIN, y + 13, { width: half - 10 })
  const leftBottom = doc.y
  const meta: [string, string][] = [
    ["Invoice number", m.invoiceNo ?? "DRAFT"], ["Issue date", m.issueDate], ["Due date", m.dueDate],
  ]
  let my = y
  for (const [k, v] of meta) {
    doc.font("Helvetica").fontSize(9).fillColor(SLATE_500).text(k, MARGIN + half, my, { width: half / 2 })
    doc.font("Helvetica-Bold").fontSize(10).fillColor(SLATE_700).text(v, MARGIN + half + half / 2, my, { width: half / 2, align: "right" })
    my += 16
  }
  return Math.max(leftBottom, my) + 16
}

/** Line table with page breaks; returns the Y after the last row. */
function drawLines(doc: PDFKit.PDFDocument, m: InvoicePdfModel, y: number, contentW: number): number {
  const cols = m.showGst
    ? [{ k: "description", w: 0.46, a: "left" }, { k: "qty", w: 0.08, a: "right" }, { k: "unitPrice", w: 0.16, a: "right" }, { k: "gst", w: 0.12, a: "right" }, { k: "amount", w: 0.18, a: "right" }]
    : [{ k: "description", w: 0.56, a: "left" }, { k: "qty", w: 0.1, a: "right" }, { k: "unitPrice", w: 0.16, a: "right" }, { k: "amount", w: 0.18, a: "right" }]
  const head: Record<string, string> = { description: "Description", qty: "Qty", unitPrice: m.showGst ? "Unit (ex GST)" : "Unit price", gst: "GST", amount: m.showGst ? "Amount (ex GST)" : "Amount" }
  const bottom = () => doc.page.height - MARGIN - FOOTER_H
  const row = (cells: Record<string, string>, bold: boolean, bg?: string) => {
    if (y + ROW_H > bottom()) { doc.addPage(); y = MARGIN }
    if (bg) doc.rect(MARGIN, y, contentW, ROW_H).fill(bg)
    let x = MARGIN
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(SLATE_700)
    for (const c of cols) {
      const w = contentW * c.w
      doc.text(cells[c.k] ?? "", x + 4, y + 6, { width: w - 8, align: c.a as "left" | "right", lineBreak: false, ellipsis: true })
      x += w
    }
    y += ROW_H
  }
  row(head, true, LIGHT_BG)
  for (const l of m.lines) {
    row({ description: l.description, qty: String(l.qty), unitPrice: l.unitPrice, gst: l.gst, amount: l.amount }, false)
    doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).strokeColor(BORDER).lineWidth(0.5).stroke()
  }
  return y + 10
}

/** Totals block, notes and payment details. */
function drawTotals(doc: PDFKit.PDFDocument, m: InvoicePdfModel, y: number, contentW: number): void {
  const need = 80 + (m.notes ? 40 : 0) + (m.paymentDetails ? 50 : 0)
  if (y + need > doc.page.height - MARGIN - FOOTER_H) { doc.addPage(); y = MARGIN }
  const x = MARGIN + contentW * 0.55
  const w = contentW * 0.45
  const rows: [string, string, boolean][] = m.showGst
    ? [["Subtotal (ex GST)", m.subtotal, false], ["GST", m.gstTotal, false], ["Total (inc GST)", m.total, true]]
    : [["Total", m.total, true]]
  for (const [k, v, bold] of rows) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10).fillColor(bold ? PRIMARY_HEX : SLATE_700)
    doc.text(k, x, y, { width: w / 2 }); doc.text(v, x + w / 2, y, { width: w / 2, align: "right" })
    y += bold ? 20 : 16
  }
  y += 10
  if (m.notes) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(SLATE_500).text("NOTES", MARGIN, y)
    doc.font("Helvetica").fontSize(10).fillColor(SLATE_700).text(m.notes, MARGIN, y + 12, { width: contentW })
    y = doc.y + 12
  }
  if (m.paymentDetails) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(SLATE_500).text("HOW TO PAY", MARGIN, y)
    doc.font("Helvetica").fontSize(10).fillColor(SLATE_700).text(m.paymentDetails, MARGIN, y + 12, { width: contentW })
  }
}

/** Footer on every page: church name · ABN · email. */
function drawFooters(doc: PDFKit.PDFDocument, m: InvoicePdfModel, contentW: number): void {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const saved = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    const text = [m.church.name, m.church.abn ? `ABN ${m.church.abn}` : "", m.church.email].filter(Boolean).join("  ·  ")
    doc.font("Helvetica").fontSize(8).fillColor(SLATE_500).text(text, MARGIN, doc.page.height - MARGIN - 12, { width: contentW, align: "center" })
    doc.page.margins.bottom = saved
  }
}

/** Diagonal DRAFT watermark on every page. */
function drawWatermark(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.save().rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .font("Helvetica-Bold").fontSize(110).fillColor("#cbd5e1").opacity(0.35)
      .text("DRAFT", 0, doc.page.height / 2 - 60, { width: doc.page.width, align: "center", lineBreak: false })
      .restore()
    doc.opacity(1)
  }
}

/** Render an invoice to a PDF buffer (A4). */
export async function renderInvoicePdf(model: InvoicePdfModel): Promise<Buffer> {
  const letterhead = await getLetterheadAsset()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    const contentW = doc.page.width - MARGIN * 2
    let y = drawHeader(doc, model, letterhead, contentW)
    y = drawParties(doc, model, y, contentW)
    y = drawLines(doc, model, y, contentW)
    drawTotals(doc, model, y, contentW)
    drawFooters(doc, model, contentW)
    if (model.draft) drawWatermark(doc)
    doc.end()
  })
}
```

Check `@/lib/theme/palette` exports the names used (DGR imports `PRIMARY_HEX, ACCENT_HEX, SLATE_700, SLATE_500, SLATE_400, GREEN, BORDER, LIGHT_BG`). If `pdfkit` types lack `PDFKit.PDFDocument` global namespace, use `InstanceType<typeof PDFDocument>` like DGR does (check its helper signatures).

- [ ] **Step 6: Run model + render tests — expect PASS.**

- [ ] **Step 7: Failing route test** — `src/app/(dashboard)/accounting/invoices/[id]/pdf/__tests__/route.test.ts`:

```ts
/** @jest-environment node */
import { GET } from "../route"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { loadInvoicePdf } from "@/lib/invoicePdfModel"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/invoicePdfModel", () => ({ loadInvoicePdf: jest.fn() }))

const mockAuth = auth as jest.Mock
const call = (id: string) => GET({} as never, { params: Promise.resolve({ id }) })
beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(loadInvoicePdf as jest.Mock).mockResolvedValue({ pdf: Buffer.from("%PDF-fake"), filename: "INV-0001.pdf", invoiceNo: "INV-0001" })
})

describe("GET invoice pdf", () => {
  it("401 unauthenticated", async () => { mockAuth.mockResolvedValue(null); expect((await call("5")).status).toBe(401) })
  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("403 for %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } }); expect((await call("5")).status).toBe(403)
  })
  it("400 bad id", async () => expect((await call("abc")).status).toBe(400))
  it("404 missing", async () => { (loadInvoicePdf as jest.Mock).mockResolvedValue(null); expect((await call("5")).status).toBe(404) })
  it("downloads as attachment and audits", async () => {
    const res = await call("5")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="INV-0001.pdf"')
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_PDF_DOWNLOADED", "Invoice", 5, { invoiceNo: "INV-0001" })
  })
  it("allows OFFICE_ADMIN", async () => { mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } }); expect((await call("5")).status).toBe(200) })
})
```

- [ ] **Step 8: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { canViewAccounting } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { loadInvoicePdf } from "@/lib/invoicePdfModel"
import { UserRole } from "@/lib/generated/prisma/enums"

/** Download an invoice PDF. Accounting viewers except AUDITOR (the PDF carries recipient contact details). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = session.user.role
  if (!canViewAccounting(role) || role === UserRole.AUDITOR) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const id = parseRouteId(params.id)
  if (id === null) return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
  const out = await loadInvoicePdf(id)
  if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await logAudit(actorId(session), "INVOICE_PDF_DOWNLOADED", "Invoice", id, { invoiceNo: out.invoiceNo })
  return new NextResponse(out.pdf as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
  })
}
```

- [ ] **Step 9: Run route test — expect PASS.** Run all invoice tests: `npm test -- --testPathPatterns="invoice|Invoice"`.

- [ ] **Step 10: Commit** — `git commit -m "feat(invoices): render and download invoice PDFs"`

---

### Task 8: Send, mark sent, resend

**Files:**
- Create: `src/lib/actions/invoiceSend.ts`, `src/lib/invoiceEmail.ts`, `src/components/accounting/InvoiceSendActions.tsx`
- Modify: `src/app/(dashboard)/accounting/invoices/[id]/page.tsx` (mount actions)
- Test: `src/lib/actions/__tests__/invoiceSend.test.ts`, `src/lib/__tests__/invoiceEmail.test.ts`

**Interfaces:**
- Consumes: `formatInvoiceNo` (Task 2), `getInvoiceSettings` (Task 3), `loadInvoicePdf` (Task 7), `sendEmail(to, subject, html, text, attachments?)` (`@/lib/email`), `getChurchSettingsStrict`.
- Produces:
  - `sendInvoice(id: number): Promise<{ success: string } | { error: string }>` — DRAFT → SENT with email
  - `markInvoiceSent(id: number): Promise<{ success: string } | { error: string }>` — DRAFT → SENT, no email
  - `resendInvoice(id: number): Promise<{ success: string } | { error: string }>` — SENT only
  - `buildInvoiceEmail(meta: { churchName: string; recipientName: string; invoiceNo: string; total: string; dueDate: string; paymentDetails: string }): { subject: string; html: string; text: string }`
  - module-private `allocateAndFreeze(id, uid, { markSent: boolean })`

Behaviour for `sendInvoice`:
1. Gate; load row; must be DRAFT with a recipient email (`"Add a recipient email first, or use Mark as sent"`).
2. `allocateAndFreeze(id, uid, { markSent: false })` — in `$transaction`: if `invoiceNo` null → `aggregate _max seq` + 1, `updateMany({ where: { id, status: DRAFT, invoiceNo: null }, data: { seq, invoiceNo, taxInvoice: gstRegistered } })`; if `count === 0` → re-read (another tab allocated) and continue only if still DRAFT. Retry once on P2002. If invoice already numbered, only refresh `taxInvoice`.
3. `loadInvoicePdf(id)` (now renders as numbered draft → but status still DRAFT, so watermark!). To avoid a watermarked emailed PDF, render after flipping status: do the status flip `updateMany({ where: { id, status: DRAFT }, data: { status: SENT, sentAt: now, sentById: uid } })` **first**, then render + email; on email failure revert with `updateMany({ where: { id, status: SENT, sentAt: now }, data: { status: DRAFT, sentAt: null, sentById: null } })`, audit `INVOICE_SEND_FAILED`, return `{ error: "Email failed — the invoice is still a draft (number kept). Try again or mark it as sent." }`.
4. Success: audit `INVOICE_SENT` `{ invoiceNo }`; revalidate list + detail; `{ success: "Invoice INV-0001 emailed" }`.

- [ ] **Step 1: Failing email-builder test** — `src/lib/__tests__/invoiceEmail.test.ts`:

```ts
import { buildInvoiceEmail } from "@/lib/invoiceEmail"

describe("buildInvoiceEmail", () => {
  const meta = { churchName: "Example Church", recipientName: "Example <Scouts>", invoiceNo: "INV-0001", total: "$330.00", dueDate: "25 October 2026", paymentDetails: "BSB 000-000" }
  it("builds subject and text", () => {
    const e = buildInvoiceEmail(meta)
    expect(e.subject).toBe("Invoice INV-0001 from Example Church")
    expect(e.text).toContain("$330.00"); expect(e.text).toContain("25 October 2026"); expect(e.text).toContain("BSB 000-000")
  })
  it("escapes HTML", () => {
    expect(buildInvoiceEmail(meta).html).toContain("Example &lt;Scouts&gt;")
    expect(buildInvoiceEmail(meta).html).not.toContain("<Scouts>")
  })
})
```

- [ ] **Step 2: Implement `src/lib/invoiceEmail.ts`**

```ts
// Plain invoice email body. v1 uses fixed copy (no admin-editable template).
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

/** Subject, HTML and text for the email that carries an invoice PDF. */
export function buildInvoiceEmail(meta: {
  churchName: string; recipientName: string; invoiceNo: string; total: string; dueDate: string; paymentDetails: string
}): { subject: string; html: string; text: string } {
  const subject = `Invoice ${meta.invoiceNo} from ${meta.churchName}`
  const lines = [
    `Dear ${meta.recipientName},`, "",
    `Please find attached invoice ${meta.invoiceNo} for ${meta.total}, due ${meta.dueDate}.`,
    ...(meta.paymentDetails ? ["", "How to pay:", meta.paymentDetails] : []),
    "", "Thank you,", meta.churchName,
  ]
  const text = lines.join("\n")
  const html = lines.map((l) => (l === "" ? "<br>" : `<p style="margin:0">${esc(l).replace(/\n/g, "<br>")}</p>`)).join("\n")
  return { subject, html, text }
}
```

Run: PASS.

- [ ] **Step 3: Failing action tests** — `src/lib/actions/__tests__/invoiceSend.test.ts`:

```ts
import { sendInvoice, markInvoiceSent, resendInvoice } from "@/lib/actions/invoiceSend"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { sendEmail } from "@/lib/email"
import { loadInvoicePdf } from "@/lib/invoicePdfModel"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }))
jest.mock("@/lib/invoicePdfModel", () => ({ loadInvoicePdf: jest.fn() }))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn(async () => ({ gstRegistered: true, paymentDetails: "BSB 000-000" })) }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettingsStrict: jest.fn(async () => ({ name: "Example Church", address: "", abn: "", email: "" })) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { invoice: { findUnique: jest.fn(), aggregate: jest.fn(), updateMany: jest.fn() }, $transaction: jest.fn() },
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
const draft = { id: 11, status: "DRAFT", invoiceNo: null, recipientEmail: "enc:scouts@example.com" }
beforeEach(() => {
  jest.clearAllMocks(); as("ADMIN")
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue(draft)
  ;(prisma.invoice.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: 6 } })
  ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(loadInvoicePdf as jest.Mock).mockResolvedValue({ pdf: Buffer.from("%PDF"), filename: "INV-0007.pdf", recipientEmail: "scouts@example.com", invoiceNo: "INV-0007", recipientName: "Example Scouts", total: "$330.00", dueDate: "25 October 2026" })
})

describe("sendInvoice", () => {
  it.each(["OFFICE_ADMIN", "AUDITOR", "VIEWER"])("rejects %s", async (r) => { as(r); expect(await sendInvoice(11)).toEqual({ error: "Unauthorized" }) })
  it("allocates the next number, freezes GST, flips to SENT, emails the PDF", async () => {
    expect(await sendInvoice(11)).toEqual({ success: "Invoice INV-0007 emailed" })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "DRAFT", invoiceNo: null }, data: { seq: 7, invoiceNo: "INV-0007", taxInvoice: true } })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "DRAFT" }, data: expect.objectContaining({ status: "SENT", sentById: 1 }) })
    expect(sendEmail).toHaveBeenCalledWith("scouts@example.com", "Invoice INV-0007 from Example Church", expect.any(String), expect.any(String),
      [{ filename: "INV-0007.pdf", content: expect.any(Buffer), contentType: "application/pdf" }])
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_SENT", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("requires an email", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, recipientEmail: null })
    expect(await sendInvoice(11)).toEqual({ error: "Add a recipient email first, or use Mark as sent" })
  })
  it("rejects non-drafts", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, status: "SENT" })
    expect(await sendInvoice(11)).toEqual({ error: "This invoice has changed. Reload and try again." })
  })
  it("reverts to DRAFT (keeping the number) when email fails", async () => {
    ;(sendEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
    expect(await sendInvoice(11)).toEqual({ error: "Email failed — the invoice is still a draft (number kept). Try again or mark it as sent." })
    expect(prisma.invoice.updateMany).toHaveBeenLastCalledWith({ where: { id: 11, status: "SENT", sentAt: expect.any(Date) }, data: { status: "DRAFT", sentAt: null, sentById: null } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_SEND_FAILED", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("keeps an existing number", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, invoiceNo: "INV-0003" })
    await sendInvoice(11)
    expect(prisma.invoice.aggregate).not.toHaveBeenCalled()
  })
  it("retries once on a number collision", async () => {
    const p2002 = Object.assign(new Error("unique"), { code: "P2002" })
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce(p2002).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
    expect(await sendInvoice(11)).toEqual({ success: "Invoice INV-0007 emailed" })
  })
})

describe("markInvoiceSent", () => {
  it("allocates and flips without emailing", async () => {
    expect(await markInvoiceSent(11)).toEqual({ success: "Invoice INV-0007 marked as sent" })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_MARKED_SENT", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
})

describe("resendInvoice", () => {
  it("only for SENT", async () => {
    expect(await resendInvoice(11)).toEqual({ error: "Only sent invoices can be re-sent" })
  })
  it("re-emails a SENT invoice", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...draft, status: "SENT", invoiceNo: "INV-0007" })
    expect(await resendInvoice(11)).toEqual({ success: "Invoice INV-0007 re-sent" })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_RESENT", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
})
```

- [ ] **Step 4: Run — expect FAIL.**

- [ ] **Step 5: Implement `src/lib/actions/invoiceSend.ts`**

```ts
"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { isP2002 } from "@/lib/validation"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import { formatInvoiceNo } from "@/lib/invoice"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { getChurchSettingsStrict } from "@/lib/churchSettings"
import { loadInvoicePdf } from "@/lib/invoicePdfModel"
import { buildInvoiceEmail } from "@/lib/invoiceEmail"
import { sendEmail } from "@/lib/email"

const PATH = "/accounting/invoices"
const CHANGED = { error: "This invoice has changed. Reload and try again." }
type Result = { success: string } | { error: string }

/** Revalidate the list and one invoice's detail page. */
function revalidate(id: number) {
  revalidatePath(PATH)
  revalidatePath(`${PATH}/${id}`)
}

/** Allocate INV number if missing (MAX+1, one P2002 retry) and freeze taxInvoice. Returns the number or an error. */
async function allocateAndFreeze(id: number): Promise<{ invoiceNo: string } | { error: string }> {
  const { gstRegistered } = await getInvoiceSettings()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const row = await tx.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true } })
        if (!row || row.status !== InvoiceStatus.DRAFT) return CHANGED
        if (row.invoiceNo) {
          await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.DRAFT }, data: { taxInvoice: gstRegistered } })
          return { invoiceNo: row.invoiceNo }
        }
        const agg = await tx.invoice.aggregate({ _max: { seq: true } })
        const seq = (agg._max.seq ?? 0) + 1
        const invoiceNo = formatInvoiceNo(seq)
        const res = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.DRAFT, invoiceNo: null }, data: { seq, invoiceNo, taxInvoice: gstRegistered } })
        if (res.count === 0) return CHANGED
        return { invoiceNo }
      })
    } catch (e) {
      if (isP2002(e) && attempt === 0) continue
      logger.error("allocateInvoiceNo failed", { message: e instanceof Error ? e.message : "unknown" })
      return { error: "Could not number the invoice. Please try again." }
    }
  }
  return { error: "Could not number the invoice. Please try again." }
}

/** Email the PDF for an invoice (already SENT). Throws on mail failure. */
async function emailInvoice(id: number): Promise<string> {
  const out = await loadInvoicePdf(id)
  if (!out || !out.invoiceNo || !out.recipientEmail) throw new Error("invoice not renderable")
  const [church, settings] = await Promise.all([getChurchSettingsStrict(), getInvoiceSettings()])
  const mail = buildInvoiceEmail({
    churchName: church.name, recipientName: out.recipientName, invoiceNo: out.invoiceNo,
    total: out.total, dueDate: out.dueDate, paymentDetails: settings.paymentDetails,
  })
  await sendEmail(out.recipientEmail, mail.subject, mail.html, mail.text, [
    { filename: out.filename, content: out.pdf, contentType: "application/pdf" },
  ])
  return out.invoiceNo
}

/** Shared DRAFT → SENT flow; `email` decides whether the PDF is emailed. */
async function send(id: number, email: boolean): Promise<Result> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const uid = actorId(session)
  const row = await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true, recipientEmail: true } })
  if (!row || row.status !== InvoiceStatus.DRAFT) return CHANGED
  if (email && !row.recipientEmail) return { error: "Add a recipient email first, or use Mark as sent" }

  const alloc = await allocateAndFreeze(id)
  if ("error" in alloc) return alloc
  const { invoiceNo } = alloc

  const sentAt = new Date()
  const flip = await prisma.invoice.updateMany({ where: { id, status: InvoiceStatus.DRAFT }, data: { status: InvoiceStatus.SENT, sentAt, sentById: uid } })
  if (flip.count === 0) return CHANGED

  if (!email) {
    await logAudit(uid, "INVOICE_MARKED_SENT", "Invoice", id, { invoiceNo })
    revalidate(id)
    return { success: `Invoice ${invoiceNo} marked as sent` }
  }
  try {
    await emailInvoice(id)
  } catch (e) {
    logger.error("sendInvoice email failed", { message: e instanceof Error ? e.message : "unknown" })
    await prisma.invoice.updateMany({ where: { id, status: InvoiceStatus.SENT, sentAt }, data: { status: InvoiceStatus.DRAFT, sentAt: null, sentById: null } })
    await logAudit(uid, "INVOICE_SEND_FAILED", "Invoice", id, { invoiceNo })
    revalidate(id)
    return { error: "Email failed — the invoice is still a draft (number kept). Try again or mark it as sent." }
  }
  await logAudit(uid, "INVOICE_SENT", "Invoice", id, { invoiceNo })
  revalidate(id)
  return { success: `Invoice ${invoiceNo} emailed` }
}

/** Number, freeze and email a DRAFT invoice. */
export async function sendInvoice(id: number): Promise<Result> {
  return send(id, true)
}

/** Number and freeze a DRAFT invoice without emailing (printed / delivered by hand). */
export async function markInvoiceSent(id: number): Promise<Result> {
  return send(id, false)
}

/** Re-email an already SENT invoice (same number, same frozen content). */
export async function resendInvoice(id: number): Promise<Result> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const row = await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true, recipientEmail: true } })
  if (!row || row.status !== InvoiceStatus.SENT) return { error: "Only sent invoices can be re-sent" }
  if (!row.recipientEmail) return { error: "This invoice has no recipient email" }
  try {
    await emailInvoice(id)
  } catch (e) {
    logger.error("resendInvoice failed", { message: e instanceof Error ? e.message : "unknown" })
    return { error: "Email failed. Please try again." }
  }
  await logAudit(actorId(session), "INVOICE_RESENT", "Invoice", id, { invoiceNo: row.invoiceNo })
  return { success: `Invoice ${row.invoiceNo} re-sent` }
}
```

Note the test mocks `findUnique` to always return the draft; inside `allocateAndFreeze` the transaction reads it too — fine with the mock. For the "existing number" test, `aggregate` must not be called — satisfied by the `row.invoiceNo` branch.

- [ ] **Step 6: Run — expect PASS.**

- [ ] **Step 7: UI** — `src/components/accounting/InvoiceSendActions.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { sendInvoice, markInvoiceSent, resendInvoice } from "@/lib/actions/invoiceSend"
import type { InvoiceStatus } from "@/lib/generated/prisma/enums"

/** Send / Mark as sent (DRAFT) and Re-send (SENT) buttons with inline result message. */
export function InvoiceSendActions({ id, status, hasEmail }: Readonly<{ id: number; status: InvoiceStatus; hasEmail: boolean }>) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = (fn: (id: number) => Promise<{ success: string } | { error: string }>, confirmText: string) => {
    if (!window.confirm(confirmText)) return
    start(async () => {
      const r = await fn(id)
      setMsg("error" in r ? { ok: false, text: r.error } : { ok: true, text: r.success })
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && (
        <>
          <Button type="button" disabled={pending || !hasEmail} title={hasEmail ? undefined : "Add a recipient email to send by email"}
            onClick={() => run(sendInvoice, "Email this invoice? It will be numbered and can no longer be edited.")}>Send by email</Button>
          <Button type="button" variant="outline" disabled={pending}
            onClick={() => run(markInvoiceSent, "Mark as sent? It will be numbered and can no longer be edited. You deliver it yourself.")}>Mark as sent (I&apos;ll deliver it)</Button>
        </>
      )}
      {status === "SENT" && hasEmail && (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(resendInvoice, "Email this invoice again?")}>Re-send</Button>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{msg.text}</p>}
    </div>
  )
}
```

Mount on the detail page for `canAccessAccounting`: `<InvoiceSendActions id={inv.id} status={inv.status} hasEmail={!!inv.recipientEmail} />`.

- [ ] **Step 8: Run all invoice tests + lint** — `npm test -- --testPathPatterns="invoice|Invoice" && npx eslint src/lib/actions/invoiceSend.ts src/lib/invoiceEmail.ts src/components/accounting/InvoiceSendActions.tsx`

- [ ] **Step 9: Commit** — `git commit -m "feat(invoices): send, mark sent and re-send invoices"`

---

### Task 9: Navigation, docs, PR 1

**Files:**
- Modify: `src/components/layout/sidebar/navData.ts`
- Create: `website/src/content/docs/docs/invoices.md`
- Modify: `website/src/content/docs/docs/accounting-overview.md`, `roles-and-permissions.md`, `data-encryption.md`, `settings-and-branding.md`, `README.md` (feature list line)
- Test: existing navData test if any (`npm test -- --testPathPatterns="navData|Sidebar"`)

- [ ] **Step 1: Nav** — add `FileText` to the lucide import block and, in the Accounting → Admin `items`, after DGR Receipts:

```ts
              { href: "/accounting/invoices", label: "Invoices", icon: FileText, show: isAccountingViewer },
              { href: "/accounting/customers", label: "Customers", icon: Users, show: isAccountingViewer },
```

Update any nav snapshot/test expectations.

- [ ] **Step 2: Docs** — `website/src/content/docs/docs/invoices.md` (match frontmatter of `receipts.md`): what invoices are; members vs customers; creating a draft; GST setting + Tax Invoice; sending by email vs "Mark as sent"; downloading the PDF; numbering (INV-0001, allocated on send, drafts unnumbered); who can do what (table from the spec's access section). Add "coming next: mark paid, void" only if PR 2 is not merged yet — otherwise omit. Link it from `accounting-overview.md`. Add `Customer` and `Invoice` encrypted fields to `data-encryption.md`, roles rows to `roles-and-permissions.md`, the two invoice settings to `settings-and-branding.md`, and one README feature bullet.

- [ ] **Step 3: Full verification**

```bash
npm test -- --testPathPatterns="invoice|Invoice|customer|navData|rotate-encryption-key|encryption-coverage"
npx eslint src "website/src/content/docs/docs/invoices.md" --no-warn-ignored
npx tsc --noEmit
```

Expected: all pass, no type errors. Do not run `npm run build` (CI builds).

- [ ] **Step 4: Commit + open PR 1**

```bash
git add -A
git commit -m "docs(invoices): add invoices docs and navigation"
git push -u origin feat/invoices
gh pr create --title "feat(accounting): invoices — customers, drafts, PDF and sending" --body-file <(cat <<'EOF'
## Summary
- Customers (saved outside parties) + Invoice model, `Transaction.invoiceId`
- Draft invoices with GST-optional line items, server-computed totals
- PDF (PDFKit, letterhead) with download; DRAFT watermark
- Send by email or mark as sent; INV-#### numbering on send
- Settings: GST registered, payment details
- Adds a migration → St Mark PROD_VERSION bump needs human review

Part 1 of 2 for OSS-20 (mark paid / void follow in PR 2). Spec: docs/superpowers/specs/2026-10-11-invoices-design.md

## Test plan
- [ ] Jest suites for invoice maths, actions, PDF, route
- [ ] Manual: create customer, draft invoice, download PDF, mark as sent

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

Then add the PR to the board (`gh project item-add 3 --owner ginutgeorge-Aus --url <pr-url>`), request `@codex review`, and follow the repo review gate (CodeRabbit on head, dispositions table) before merging.

---

## PR 2 — Payment, void, totals

Branch `feat/invoices-payment` from `main` after PR 1 merges.

### Task 10: Mark paid (link or create) + receipt, unmark

**Files:**
- Create: `src/lib/actions/invoicePayment.ts`, `src/components/accounting/MarkPaidDialog.tsx`
- Modify: `src/app/(dashboard)/accounting/invoices/[id]/page.tsx`
- Test: `src/lib/actions/__tests__/invoicePayment.test.ts`

**Interfaces:**
- Consumes: `assertUnlocked(date: Date): Promise<string | null>` (`@/lib/accountingLock`); `sendSingleReceipt(transactionId: number, toEmail: string): Promise<{ success: string } | { error: string }>` (`@/lib/actions/receipt`); `encrypt`, `safeDecrypt`.
- Produces:
  - `type MarkPaidInput = { mode: "link"; transactionId: number; sendReceipt: boolean } | { mode: "create"; date: string; paymentAccountId: number; sendReceipt: boolean }`
  - `markInvoicePaid(id: number, input: MarkPaidInput): Promise<{ success: string; warning?: string } | { error: string }>`
  - `unmarkInvoicePaid(id: number): Promise<{ success: string } | { error: string }>`
  - `type PaymentCandidate = { id: number; date: string; amount: string; reference: string | null; paymentAccountName: string | null }`
  - `listPaymentCandidates(id: number): Promise<PaymentCandidate[] | { error: string }>` — unlinked INCOME transactions, `amount === total`, `date >= issueDate`, newest first, max 20 (description not returned)

- [ ] **Step 1: Failing tests** — `src/lib/actions/__tests__/invoicePayment.test.ts`:

```ts
import { markInvoicePaid, unmarkInvoicePaid, listPaymentCandidates } from "@/lib/actions/invoicePayment"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { assertUnlocked } from "@/lib/accountingLock"
import { sendSingleReceipt } from "@/lib/actions/receipt"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn(async () => null) }))
jest.mock("@/lib/actions/receipt", () => ({ sendSingleReceipt: jest.fn(async () => ({ success: "sent" })) }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`), safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findUnique: jest.fn(), updateMany: jest.fn() },
    transaction: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    paymentAccount: { findUnique: jest.fn() },
    account: { findUnique: jest.fn() },
    fund: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
const inv = { id: 11, status: "SENT", invoiceNo: "INV-0007", recipientName: "Example Scouts", recipientEmail: "enc:scouts@example.com",
  personId: null, total: { toString: () => "330.00" }, issueDate: new Date("2026-10-11"), accountId: 4, fundId: null }
beforeEach(() => {
  jest.clearAllMocks(); as("ADMIN")
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue(inv)
  ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 50, type: "INCOME", invoiceId: null, amount: { toString: () => "330.00" }, date: new Date("2026-10-20") })
  ;(prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 51 })
  ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({ id: 2, kind: "BANK", isActive: true })
  ;(prisma.account.findUnique as jest.Mock).mockResolvedValue({ id: 4, type: "INCOME", isActive: true })
})

describe("markInvoicePaid — link", () => {
  const link = { mode: "link" as const, transactionId: 50, sendReceipt: false }
  it.each(["OFFICE_ADMIN", "AUDITOR"])("rejects %s", async (r) => { as(r); expect(await markInvoicePaid(11, link)).toEqual({ error: "Unauthorized" }) })
  it("links and flips to PAID", async () => {
    expect(await markInvoicePaid(11, link)).toEqual({ success: "INV-0007 marked paid" })
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({ where: { id: 50, invoiceId: null }, data: { invoiceId: 11 } })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "SENT" }, data: { status: "PAID", paidAt: new Date("2026-10-20") } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_PAID", "Invoice", 11, { invoiceNo: "INV-0007", transactionId: 50, mode: "link" })
  })
  it("rejects amount mismatch", async () => {
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 50, type: "INCOME", invoiceId: null, amount: { toString: () => "300.00" }, date: new Date("2026-10-20") })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "The transaction amount must equal the invoice total ($330.00)" })
  })
  it("rejects an expense or already-linked transaction", async () => {
    ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 50, type: "EXPENSE", invoiceId: null, amount: { toString: () => "330.00" }, date: new Date() })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Pick an income transaction that is not linked to another invoice" })
  })
  it("rejects a locked period", async () => {
    ;(assertUnlocked as jest.Mock).mockResolvedValueOnce("Period locked")
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Period locked" })
  })
  it("rejects when not SENT", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, status: "DRAFT" })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "Only sent invoices can be marked paid" })
  })
  it("fails cleanly if the invoice changed mid-flight", async () => {
    ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await markInvoicePaid(11, link)).toEqual({ error: "This invoice has changed. Reload and try again." })
  })
})

describe("markInvoicePaid — create", () => {
  const create = { mode: "create" as const, date: "2026-10-20", paymentAccountId: 2, sendReceipt: true }
  it("creates an income transaction, links it, sends receipt", async () => {
    expect(await markInvoicePaid(11, create)).toEqual({ success: "INV-0007 marked paid" })
    expect(prisma.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: "INCOME", amount: "330.00", accountId: 4, paymentAccountId: 2, fundId: null, reference: "INV-0007",
      description: "enc:Invoice INV-0007 — Example Scouts", invoiceId: 11, date: new Date("2026-10-20"),
    }) })
    expect(sendSingleReceipt).toHaveBeenCalledWith(51, "scouts@example.com")
  })
  it("rejects a cash or inactive payment account", async () => {
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({ id: 2, kind: "CASH", isActive: true })
    expect(await markInvoicePaid(11, create)).toEqual({ error: "Choose an active bank account" })
  })
  it("rejects an invalid date", async () => {
    expect(await markInvoicePaid(11, { ...create, date: "2026-02-30" })).toEqual({ error: "Invalid payment date" })
  })
  it("warns but keeps PAID when the receipt fails", async () => {
    ;(sendSingleReceipt as jest.Mock).mockResolvedValueOnce({ error: "no consent" })
    expect(await markInvoicePaid(11, create)).toEqual({ success: "INV-0007 marked paid", warning: "Receipt not sent: no consent" })
  })
})

describe("unmarkInvoicePaid", () => {
  it("clears the link and returns to SENT", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ ...inv, status: "PAID" })
    expect(await unmarkInvoicePaid(11)).toEqual({ success: "Payment unlinked — INV-0007 is unpaid again" })
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({ where: { invoiceId: 11 }, data: { invoiceId: null } })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "PAID" }, data: { status: "SENT", paidAt: null } })
  })
})

describe("listPaymentCandidates", () => {
  it("filters unlinked income with equal amount on/after issue date", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ id: 50, date: new Date("2026-10-20"), amount: { toString: () => "330.00" }, reference: "INV-0007", paymentAccount: { name: "Main" } }])
    expect(await listPaymentCandidates(11)).toEqual([{ id: 50, date: "2026-10-20", amount: "330.00", reference: "INV-0007", paymentAccountName: "Main" }])
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { type: "INCOME", invoiceId: null, amount: "330.00", date: { gte: inv.issueDate } }, take: 20,
    }))
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `src/lib/actions/invoicePayment.ts`**

```ts
"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { assertUnlocked } from "@/lib/accountingLock"
import { isRealCalendarDate, isValidPgId } from "@/lib/validation"
import { toCents, fmtAUD, centsToNumber } from "@/lib/formatting"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import { sendSingleReceipt } from "@/lib/actions/receipt"

const CHANGED = { error: "This invoice has changed. Reload and try again." }
const REPORT_PATHS = ["/accounting", "/accounting/transactions", "/accounting/reports/pl", "/accounting/reports/balance-sheet", "/accounting/reports/budget-vs-actual", "/accounting/reports/funds"]

export type MarkPaidInput =
  | { mode: "link"; transactionId: number; sendReceipt: boolean }
  | { mode: "create"; date: string; paymentAccountId: number; sendReceipt: boolean }
export type PaymentCandidate = { id: number; date: string; amount: string; reference: string | null; paymentAccountName: string | null }

/** Revalidate invoice pages plus ledger/report pages touched by a payment link change. */
function revalidate(id: number) {
  revalidatePath("/accounting/invoices")
  revalidatePath(`/accounting/invoices/${id}`)
  for (const p of REPORT_PATHS) revalidatePath(p)
}

/** Mark a SENT invoice paid by linking an existing income transaction or creating one; optionally email a receipt. */
export async function markInvoicePaid(id: number, input: MarkPaidInput): Promise<{ success: string; warning?: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const uid = actorId(session)
  const inv = await prisma.invoice.findUnique({ where: { id } })
  if (!inv) return { error: "Invoice not found" }
  if (inv.status !== InvoiceStatus.SENT) return { error: "Only sent invoices can be marked paid" }
  const totalCents = toCents(inv.total.toString())
  const totalStr = inv.total.toString()

  let txId: number
  let paidAt: Date
  if (input.mode === "link") {
    if (!isValidPgId(input.transactionId)) return { error: "Invalid transaction" }
    const t = await prisma.transaction.findUnique({ where: { id: input.transactionId } })
    if (!t || t.type !== "INCOME" || t.invoiceId !== null) return { error: "Pick an income transaction that is not linked to another invoice" }
    if (toCents(t.amount.toString()) !== totalCents) return { error: `The transaction amount must equal the invoice total (${fmtAUD(centsToNumber(totalCents))})` }
    const lockErr = await assertUnlocked(t.date)
    if (lockErr) return { error: lockErr }
    txId = t.id
    paidAt = t.date
    const ok = await prisma.$transaction(async (tx) => {
      const flip = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.SENT }, data: { status: InvoiceStatus.PAID, paidAt } })
      if (flip.count === 0) return false
      const linked = await tx.transaction.updateMany({ where: { id: txId, invoiceId: null }, data: { invoiceId: id } })
      if (linked.count === 0) throw new Error("transaction already linked")
      return true
    }).catch(() => false)
    if (!ok) return CHANGED
  } else {
    if (!isRealCalendarDate(input.date)) return { error: "Invalid payment date" }
    paidAt = new Date(input.date)
    const lockErr = await assertUnlocked(paidAt)
    if (lockErr) return { error: lockErr }
    const pa = await prisma.paymentAccount.findUnique({ where: { id: input.paymentAccountId } })
    if (!pa || pa.kind !== "BANK" || !pa.isActive) return { error: "Choose an active bank account" }
    const acct = await prisma.account.findUnique({ where: { id: inv.accountId } })
    if (!acct || acct.type !== "INCOME" || !acct.isActive) return { error: "The invoice's income account is inactive — reactivate it first" }
    if (inv.fundId !== null) {
      const fund = await prisma.fund.findUnique({ where: { id: inv.fundId } })
      if (!fund || !fund.isActive) return { error: "The invoice's fund is inactive — reactivate it first" }
    }
    const created = await prisma.$transaction(async (tx) => {
      const flip = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.SENT }, data: { status: InvoiceStatus.PAID, paidAt } })
      if (flip.count === 0) return null
      return tx.transaction.create({
        data: {
          date: paidAt, type: "INCOME", amount: totalStr, accountId: inv.accountId, paymentAccountId: pa.id, fundId: inv.fundId,
          personId: inv.personId, reference: inv.invoiceNo, invoiceId: id,
          description: encrypt(`Invoice ${inv.invoiceNo} — ${inv.recipientName}`),
        },
      })
    })
    if (!created) return CHANGED
    txId = created.id
  }

  await logAudit(uid, "INVOICE_PAID", "Invoice", id, { invoiceNo: inv.invoiceNo, transactionId: txId, mode: input.mode })
  revalidate(id)

  let warning: string | undefined
  if (input.sendReceipt) {
    if (!inv.recipientEmail) warning = "Receipt not sent: no recipient email"
    else {
      const r = await sendSingleReceipt(txId, safeDecrypt(inv.recipientEmail))
      if ("error" in r) warning = `Receipt not sent: ${r.error}`
    }
  }
  return warning ? { success: `${inv.invoiceNo} marked paid`, warning } : { success: `${inv.invoiceNo} marked paid` }
}

/** Undo a payment link: PAID → SENT. The transaction stays in the ledger, just unlinked. */
export async function unmarkInvoicePaid(id: number): Promise<{ success: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true } })
  if (!inv || inv.status !== InvoiceStatus.PAID) return { error: "Only paid invoices can be unmarked" }
  const ok = await prisma.$transaction(async (tx) => {
    const flip = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.PAID }, data: { status: InvoiceStatus.SENT, paidAt: null } })
    if (flip.count === 0) return false
    await tx.transaction.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } })
    return true
  })
  if (!ok) return CHANGED
  await logAudit(actorId(session), "INVOICE_UNPAID", "Invoice", id, { invoiceNo: inv.invoiceNo })
  revalidate(id)
  return { success: `Payment unlinked — ${inv.invoiceNo} is unpaid again` }
}

/** Suggest unlinked income transactions matching the invoice total, dated on/after issue. No PII returned. */
export async function listPaymentCandidates(id: number): Promise<PaymentCandidate[] | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { total: true, issueDate: true } })
  if (!inv) return { error: "Invoice not found" }
  const rows = await prisma.transaction.findMany({
    where: { type: "INCOME", invoiceId: null, amount: inv.total.toString(), date: { gte: inv.issueDate } },
    orderBy: { date: "desc" }, take: 20,
    select: { id: true, date: true, amount: true, reference: true, paymentAccount: { select: { name: true } } },
  })
  return rows.map((r) => ({ id: r.id, date: r.date.toISOString().slice(0, 10), amount: r.amount.toString(), reference: r.reference, paymentAccountName: r.paymentAccount?.name ?? null }))
}
```

The link-mode test expects `invoice.updateMany` before `transaction.updateMany` order-agnostically (both asserted with `toHaveBeenCalledWith`), fine. Check `Transaction` required fields in schema (e.g. `isGiving`, `createdById`?) and add them to `create` if required; adjust the test's `objectContaining`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: UI** — `src/components/accounting/MarkPaidDialog.tsx` (client; use `@/components/ui/dialog`):

```tsx
"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { markInvoicePaid, listPaymentCandidates, type PaymentCandidate } from "@/lib/actions/invoicePayment"
import { sydneyTodayYMD } from "@/lib/dates"

/** Mark-paid dialog: link a suggested income transaction or record a new bank payment. */
export function MarkPaidDialog({ id, bankAccounts, hasEmail }: Readonly<{ id: number; bankAccounts: { id: number; name: string }[]; hasEmail: boolean }>) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"link" | "create">("link")
  const [candidates, setCandidates] = useState<PaymentCandidate[] | null>(null)
  const [txId, setTxId] = useState<number | null>(null)
  const [date, setDate] = useState(sydneyTodayYMD())
  const [paId, setPaId] = useState<number | null>(bankAccounts[0]?.id ?? null)
  const [receipt, setReceipt] = useState(hasEmail)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    if (!open) return
    let live = true
    listPaymentCandidates(id).then((r) => {
      if (!live) return
      const list = "error" in r ? [] : r
      setCandidates(list)
      if (list.length === 0) setMode("create")
    })
    return () => { live = false }
  }, [open, id])

  function submit() {
    setMsg(null)
    start(async () => {
      const input = mode === "link"
        ? (txId === null ? null : { mode: "link" as const, transactionId: txId, sendReceipt: receipt })
        : (paId === null ? null : { mode: "create" as const, date, paymentAccountId: paId, sendReceipt: receipt })
      if (!input) { setMsg("Choose a transaction or bank account"); return }
      const r = await markInvoicePaid(id, input)
      if ("error" in r) { setMsg(r.error); return }
      setOpen(false)
      if (r.warning) window.alert(r.warning)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button">Mark paid</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Mark invoice paid</DialogTitle></DialogHeader>
        {msg && <p role="alert" className="text-sm text-destructive">{msg}</p>}
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1"><input type="radio" checked={mode === "link"} onChange={() => setMode("link")} disabled={candidates?.length === 0} /> Link existing transaction</label>
          <label className="flex items-center gap-1"><input type="radio" checked={mode === "create"} onChange={() => setMode("create")} /> Record new payment</label>
        </div>
        {mode === "link" ? (
          <ul className="max-h-60 space-y-1 overflow-auto text-sm">
            {candidates === null && <li>Loading…</li>}
            {candidates?.map((c) => (
              <li key={c.id}><label className="flex items-center gap-2">
                <input type="radio" name="tx" checked={txId === c.id} onChange={() => setTxId(c.id)} />
                {c.date} · ${c.amount} · {c.paymentAccountName ?? "—"} {c.reference ? `· ${c.reference}` : ""}
              </label></li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="paidDate">Payment date</Label>
              <Input id="paidDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="paidAccount">Bank account</Label>
              <select id="paidAccount" value={paId ?? ""} onChange={(e) => setPaId(Number.parseInt(e.target.value, 10))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={receipt} disabled={!hasEmail} onChange={(e) => setReceipt(e.target.checked)} /> Email a receipt to the recipient
        </label>
        <Button type="button" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Confirm"}</Button>
      </DialogContent>
    </Dialog>
  )
}
```

Detail page: for `canAccessAccounting`, status SENT → `<MarkPaidDialog id bankAccounts={await prisma.paymentAccount.findMany({ where: { kind: "BANK", isActive: true }, select: { id: true, name: true } })} hasEmail={!!inv.recipientEmail} />`; status PAID → "Unmark paid" button (small client component calling `unmarkInvoicePaid` with confirm) and a link to `/accounting/transactions?highlight=${inv.paymentTransactionId}` (or the transaction edit page path used elsewhere — check `TransactionTable` links).

- [ ] **Step 6: Tests + lint, commit** — `git commit -m "feat(invoices): mark invoices paid by linking or creating income"`

---

### Task 11: Void

**Files:**
- Create: `src/lib/actions/invoiceVoid.ts`, `src/components/accounting/VoidInvoiceDialog.tsx`
- Modify: detail page
- Test: `src/lib/actions/__tests__/invoiceVoid.test.ts`

**Interfaces:**
- Produces: `voidInvoice(id: number, reason: string): Promise<{ success: string } | { error: string }>` — SENT → VOID; PAID returns `"Unmark the payment before voiding"`.

- [ ] **Step 1: Failing test**

```ts
import { voidInvoice } from "@/lib/actions/invoiceVoid"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { invoice: { findUnique: jest.fn(), updateMany: jest.fn() } } }))

const mockAuth = auth as jest.Mock
beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ status: "SENT", invoiceNo: "INV-0007" })
  ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
})

describe("voidInvoice", () => {
  it("rejects OFFICE_ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    expect(await voidInvoice(11, "Duplicate")).toEqual({ error: "Unauthorized" })
  })
  it("requires a reason", async () => expect(await voidInvoice(11, "  ")).toEqual({ error: "Give a reason for voiding" }))
  it("voids a SENT invoice", async () => {
    expect(await voidInvoice(11, "Duplicate")).toEqual({ success: "INV-0007 voided" })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "SENT" }, data: { status: "VOID", voidedAt: expect.any(Date), voidReason: "Duplicate" } })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_VOIDED", "Invoice", 11, { invoiceNo: "INV-0007" })
  })
  it("refuses PAID", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ status: "PAID", invoiceNo: "INV-0007" })
    expect(await voidInvoice(11, "x")).toEqual({ error: "Unmark the payment before voiding" })
  })
  it("refuses DRAFT", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ status: "DRAFT", invoiceNo: null })
    expect(await voidInvoice(11, "x")).toEqual({ error: "Only sent invoices can be voided — delete the draft instead" })
  })
})
```

- [ ] **Step 2: Implement**

```ts
"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"

/** Void a SENT invoice with a reason. The number stays used; PAID must be unmarked first. */
export async function voidInvoice(id: number, reason: string): Promise<{ success: string } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const r = typeof reason === "string" ? reason.trim() : ""
  if (!r) return { error: "Give a reason for voiding" }
  if (r.length > 500) return { error: "Reason must be 500 characters or fewer" }
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true } })
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
```

- [ ] **Step 3: UI** — `VoidInvoiceDialog.tsx`: Dialog with reason textarea (required, max 500) and "Void invoice" destructive button calling `voidInvoice`, then `router.refresh()`. Show on detail page for SENT + canAccessAccounting. Detail page shows `voidReason` + `voidedAt` when VOID; PDF of a VOID invoice still downloads (no watermark change in v1).

- [ ] **Step 4: Tests + lint, commit** — `git commit -m "feat(invoices): void sent invoices"`

---

### Task 12: List totals (outstanding, paid, GST collected), docs, PR 2

**Files:**
- Create: `src/lib/invoiceSummary.ts`
- Modify: `src/app/(dashboard)/accounting/invoices/page.tsx`, `website/src/content/docs/docs/invoices.md`
- Test: `src/lib/__tests__/invoiceSummary.test.ts`

**Interfaces:**
- Produces: `summarizeInvoices(rows: { status: InvoiceStatus; total: string; gstTotal: string; paidAt: Date | null }[], period: { from: Date; to: Date }): { outstandingCents: number; outstandingCount: number; paidCents: number; gstCollectedCents: number }` — outstanding = SENT; paid/GST = PAID with `paidAt` in `[from, to]`.

- [ ] **Step 1: Failing test**

```ts
import { summarizeInvoices } from "@/lib/invoiceSummary"

const period = { from: new Date("2026-10-01"), to: new Date("2026-10-31") }
it("summarises outstanding, paid in period and GST collected", () => {
  expect(summarizeInvoices([
    { status: "SENT", total: "110.00", gstTotal: "10.00", paidAt: null },
    { status: "SENT", total: "50.00", gstTotal: "0.00", paidAt: null },
    { status: "PAID", total: "330.00", gstTotal: "30.00", paidAt: new Date("2026-10-20") },
    { status: "PAID", total: "99.00", gstTotal: "9.00", paidAt: new Date("2026-09-30") },
    { status: "VOID", total: "10.00", gstTotal: "0.00", paidAt: null },
    { status: "DRAFT", total: "10.00", gstTotal: "0.00", paidAt: null },
  ], period)).toEqual({ outstandingCents: 16000, outstandingCount: 2, paidCents: 33000, gstCollectedCents: 3000 })
})
```

- [ ] **Step 2: Implement**

```ts
import { toCents } from "@/lib/formatting"
import type { InvoiceStatus } from "@/lib/generated/prisma/enums"

/** Outstanding (SENT) totals plus paid and GST collected for invoices paid within the period, in cents. */
export function summarizeInvoices(
  rows: { status: InvoiceStatus; total: string; gstTotal: string; paidAt: Date | null }[],
  period: { from: Date; to: Date },
) {
  let outstandingCents = 0, outstandingCount = 0, paidCents = 0, gstCollectedCents = 0
  for (const r of rows) {
    if (r.status === "SENT") { outstandingCents += toCents(r.total); outstandingCount++ }
    if (r.status === "PAID" && r.paidAt && r.paidAt >= period.from && r.paidAt <= period.to) {
      paidCents += toCents(r.total)
      gstCollectedCents += toCents(r.gstTotal)
    }
  }
  return { outstandingCents, outstandingCount, paidCents, gstCollectedCents }
}
```

- [ ] **Step 3: List page** — above the table, three stat cards: "Outstanding" (`fmtAUD` + count), "Paid (period)", and "GST collected (period)" only when `getInvoiceSettings().gstRegistered`. Period = the `from`/`to` filter if set, else current Sydney month (`sydneyMonthKey` → first/last day). Feed it an unfiltered-by-status query: add `listInvoiceSummaryRows(): Promise<...>` to `src/lib/actions/invoice.ts` selecting `{ status, total, gstTotal, paidAt }` where `status in [SENT, PAID]` (canViewAccounting), and test it in `invoice.test.ts` (role gate + select shape).

- [ ] **Step 4: Docs** — extend `invoices.md`: marking paid (link vs record new; receipt), unmarking, voiding, GST collected figure for BAS (states it is cash-basis from paid invoices only, gross amounts in the ledger). Update README bullet if it says "coming soon".

- [ ] **Step 5: Verify + PR 2**

```bash
npm test -- --testPathPatterns="invoice|Invoice"
npx eslint src --no-warn-ignored && npx tsc --noEmit
git push -u origin feat/invoices-payment
gh pr create --title "feat(accounting): invoices — mark paid, void and totals" --body "<summary + Closes OSS-20 note + test plan + Claude Code footer>"
```

Board: add PR, move OSS-20 to Review; after merge → Done. File follow-up cards from the spec's "Out of scope" list.

---

## Self-review notes

- Spec coverage: models (T1), GST setting (T3), customers + inline create (T4/T6), drafts (T5/T6), PDF + download + DRAFT watermark (T7), send / mark sent / resend + number on send (T8), nav/docs (T9), mark paid link/create + receipt + unmark (T10), void (T11), GST-collected summary (T12), AUDITOR masking (T4/T5/T7 tests), encryption registry (T1).
- Deviation from spec, intentional: PDF route lives at `src/app/(dashboard)/accounting/invoices/[id]/pdf/route.ts` (matches the DGR route) instead of `/api/accounting/...`; numbered drafts (failed email) cannot be deleted to keep the sequence gap-free; invoice email uses fixed copy (no admin template) in v1.
