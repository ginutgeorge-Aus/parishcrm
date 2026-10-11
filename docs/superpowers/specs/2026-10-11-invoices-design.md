# Invoices (OSS-20) — Design

Date: 2026-10-11 · Status: approved

## Goal

Let accounting users create, send and track invoices to church members or outside parties, and
record the payment in the ledger without double-counting.

## Decisions

- **Recipients:** a member picked from People, or a saved outside **Customer** (reusable, separate
  from People so outside parties never appear in the member directory, counts or member emails).
  New customers can be created inline from the recipient picker.
- **GST:** optional. A `gstRegistered` setting switches invoices to "Tax Invoice" with ABN, a
  per-line GST flag (10%) and a GST total.
- **Accounting basis:** cash. Invoices stay off the ledger until paid; no accounts receivable.
- **Payment:** "Mark paid" either links an existing unlinked income transaction or creates a new
  one. Full payment only (one invoice ↔ one transaction). Bank Import matching is a follow-up.
- **Lifecycle:** DRAFT → SENT → PAID, or SENT → VOID. Drafts are editable; sent invoices are
  frozen (void and re-issue, no credit notes in v1).
- **Ledger posting:** gross amount to the invoice's income account (+ optional fund). No separate
  GST liability account in v1; the invoice list reports GST collected per period for BAS.

## Data model

```prisma
model Customer {
  id        Int      @id @default(autoincrement())
  name      String               // plaintext, searchable
  abn       String?
  email     String?              // encrypted
  phone     String?              // encrypted
  address   String?              // encrypted
  notes     String?              // encrypted
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  invoices  Invoice[]
}

enum InvoiceStatus { DRAFT SENT PAID VOID }

model Invoice {
  id               Int           @id @default(autoincrement())
  invoiceNo        String?       @unique   // allocated on first send/mark-sent
  seq              Int?          @unique
  status           InvoiceStatus @default(DRAFT)
  personId         Int?          // → Person, onDelete SetNull
  customerId       Int?          // → Customer, onDelete SetNull
  recipientName    String                  // snapshot, plaintext
  recipientEmail   String?                 // snapshot, encrypted
  recipientAddress String?                 // snapshot, encrypted
  issueDate        DateTime
  dueDate          DateTime
  lines            Json          // [{ description, qty, unitPriceCents, gst }]
  subtotal         Decimal       @db.Decimal(10, 2)
  gstTotal         Decimal       @db.Decimal(10, 2)
  total            Decimal       @db.Decimal(10, 2)
  taxInvoice       Boolean       @default(false) // frozen from gstRegistered at send
  accountId        Int           // → Account (INCOME)
  fundId           Int?          // → Fund
  notes            String?       // encrypted
  sentAt           DateTime?
  paidAt           DateTime?
  voidedAt         DateTime?
  voidReason       String?
  createdById      Int
  sentById         Int?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  payment          Transaction?
}

// Transaction gains:
//   invoiceId Int? @unique  → Invoice (onDelete SetNull)
```

- At most one of `personId` / `customerId` is set (validated in the action).
- `invoiceNo` = `INV-` + zero-padded `seq` (4 digits, grows naturally). `seq` = `MAX(seq)+1`
  inside a DB transaction, retried once on P2002 — the `DgrReceipt` pattern. Deleted drafts
  never consume a number.
- New AppSettings (allowlisted): `gstRegistered` (bool), `invoicePaymentDetails` (free text, e.g.
  BSB/account, printed on the PDF).

## Money and GST

- Unit prices are entered GST-exclusive, validated by the money regex, held as integer cents.
- Line total = `qty × unitPriceCents`. Line GST = `round(lineTotal / 10)` (half-up) when the line's
  `gst` flag is set and GST is enabled; otherwise 0.
- `subtotal`, `gstTotal`, `total` are always computed server-side from `lines`; client totals are
  ignored. Conversion to `Decimal` from cents only — no `parseFloat`/`Number()` on money.
- Pure helper module `src/lib/invoiceMath.ts` (shared by form preview and server).

## Pages

All under `src/app/(dashboard)/accounting/`, added to the Accounting → Admin nav group.

- `/accounting/invoices` — list with status/date filters; summary of outstanding, paid this
  period, and GST collected (when GST enabled).
- `/accounting/invoices/new`, `/accounting/invoices/[id]/edit` — draft form: recipient picker
  (one search over People + Customers, "+ New customer" inline), issue/due dates, income account,
  fund, line items with live totals, notes.
- `/accounting/invoices/[id]` — detail with status-dependent actions and PDF download.
- `/accounting/customers` — list / edit / deactivate customers.
- Accounting settings page gains "GST registered" toggle and "Payment details" textarea.

Picking a Person fills email from the person and address from their family; picking a Customer
fills from the customer record. The snapshot is editable on the draft.

## Server actions — `src/lib/actions/invoice.ts`, `src/lib/actions/customer.ts`

Every mutation: `canAccessAccounting` (ADMIN | PASTOR), zod-validated, audit-logged
(`INVOICE_*`, `CUSTOMER_*`), returns `ActionResult`, revalidates affected paths.

| Action | From → to | Notes |
|---|---|---|
| `createInvoice` / `updateInvoice` | DRAFT | totals recomputed server-side |
| `deleteDraftInvoice` | DRAFT → (deleted) | |
| `sendInvoice` | DRAFT → SENT | allocate number if missing, freeze `taxInvoice`, render PDF, email. Email failure → stays DRAFT, keeps number, error shown + audited |
| `markInvoiceSent` | DRAFT → SENT | same as send without email (print/post, no email) |
| `resendInvoice` | SENT | re-render and re-email |
| `markInvoicePaid` | SENT → PAID | `{mode:"link", transactionId}` or `{mode:"create", date, paymentAccountId}`; optional receipt |
| `unmarkInvoicePaid` | PAID → SENT | keeps the transaction, clears the link |
| `voidInvoice` | SENT → VOID | requires reason |
| `createCustomer` / `updateCustomer` / `setCustomerActive` | — | no hard delete |

**markInvoicePaid** runs in one `$transaction`:
- status flip via `updateMany({ where: { id, status: SENT } })`; 0 rows → "already paid/changed".
- link mode: transaction must be INCOME, `invoiceId` null, amount equal to `total`, date not in a
  locked period. The `@unique` on `Transaction.invoiceId` backstops races.
- create mode: same validation as `createTransaction` (`assertUnlocked`, active INCOME account,
  BANK payment account, active fund); description `Invoice INV-0001 — <recipient>` (encrypted),
  reference = invoice number, `personId` set when the recipient is a member.
- After commit, if requested and an email exists, send a receipt via the existing
  `sendSingleReceipt` path; a receipt failure is a warning, not a rollback.
- The Mark-paid dialog suggests candidates: unlinked INCOME transactions with amount = total and
  date ≥ issue date.

## PDF

- `src/lib/pdf/InvoicePdf.ts` on PDFKit, reusing the DGR receipt letterhead, footer and
  `getChurchSettingsForReceipt()`.
- Heading "Tax Invoice" + ABN + GST column when `taxInvoice`; otherwise "Invoice".
- Shows invoice number, issue/due dates, recipient block, line table, totals, payment details.
- Drafts render with a diagonal "DRAFT" watermark and no number.
- `GET /api/accounting/invoices/[id]/pdf` — `Content-Disposition: attachment`, filename
  `INV-0001.pdf` (or `DRAFT-<id>.pdf`). Audited as `INVOICE_PDF_DOWNLOADED`.

## Access control

| Role | Invoices / customers |
|---|---|
| ADMIN, PASTOR | full |
| OFFICE_ADMIN | read-only, contact details visible, PDF download allowed |
| AUDITOR | read-only: number, recipient **name**, lines, totals, status. No email/phone/address, no PDF download, no recipient picker |
| VIEWER, EVENT_ORGANISER | none |

Gated at both page and action/route. AUDITOR masking is applied server-side before data reaches
the client (contact fields never decrypted for that role).

## Error handling

- Double-submit / concurrent edits: status-conditional `updateMany`; 0 rows → friendly error.
- Number collision: one retry on P2002.
- Linked Person/Customer removed: FK `SetNull`, invoice snapshot preserved.
- Money: regex validation before any write; integer-cent math; semgrep money rule stays green.

## Testing

- `invoiceMath`: totals, GST rounding edges, GST disabled, zero/large quantities.
- Zod schemas: lines, recipient XOR, dates (due ≥ issue).
- Actions (mocked Prisma/NextAuth per `.claude/rules/testing.md`): role gates for every role;
  status machine rejects illegal transitions; markPaid link + create incl. each guard; void,
  unmark; AUDITOR masking; encryption round-trip for recipient + customer fields.
- PDF: renders tax / plain / draft without throwing; contains invoice number.
- PDF route: role gate + audit row.

## Delivery

- Adds a migration → St Mark `PROD_VERSION` bump needs human review.
- Website docs page + README line + What's New entry.
- Two PRs:
  1. Customers, Invoice model, drafts, PDF + download, send / mark sent, settings.
  2. Mark paid (link/create) + receipt, unmark, void, GST-collected summary.

## Out of scope (follow-up cards)

- Bank Import matching of open invoices by amount + reference.
- Partial payments, credit notes, recurring invoices, overdue reminders.
- GST liability account / BAS report.
- Sunday School fees invoicing (OSS-19) building on this.
