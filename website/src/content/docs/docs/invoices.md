---
title: "Invoices"
description: "Create, send and track invoices to church members or outside customers — hall hire, venue fees and other charges — with optional GST tax invoices, PDF download, payment matching and voiding."
---

Invoices let the church bill someone for a charge — hall hire, a venue fee, a camp fee — by creating a draft, then emailing it or delivering it yourself as a PDF. An invoice can go to a **church member** (picked from People) or to a saved **customer** (an outside person or organisation, such as a community group that hires the hall). Customers are kept separate from People, so they never appear in the member directory, member counts or member emails.

## Using it

### Customers

**Accounting → Customers** (`/accounting/customers`) lists saved outside customers. ADMIN/PASTOR can add, edit and deactivate them; customers are never deleted, because invoices refer to them. You can also add a customer on the spot from the invoice form's recipient picker (**+ New customer**).

### Creating an invoice

**Accounting → Invoices → New invoice** opens a draft:

- **Recipient** — search members and customers in one box, or leave it blank and type a name. Picking a member fills in their email and their family's address; picking a customer fills in the saved details. You can edit the copied details on the draft — the invoice keeps its own copy, so later changes to the member or customer don't alter invoices already issued.
- **Issue and due dates**, the **income account** the payment will be recorded against, and an optional **fund**.
- **Lines** — description, quantity (whole number) and unit price. Totals update as you type; the server recalculates them when you save.
- **Notes** — printed on the invoice.

A draft can be edited or deleted freely. It has no number yet.

### GST and tax invoices

If the church is registered for GST, an ADMIN turns on **The church is registered for GST** under **Accounting → Acct. Settings → Invoices**. New invoices then become **Tax Invoices**: prices are entered excluding GST, each line has a GST tick-box (10%), and the PDF shows the church's ABN, a GST column, the GST total and the GST-inclusive total. A tax invoice needs the church name, address and ABN set under **Settings → Church Information**.

The same settings card holds **Payment details** (for example bank account and reference instructions), printed under "How to pay" on every invoice.

Whether an invoice is a tax invoice is fixed when it is sent — its GST and totals are recalculated from the lines at that moment — so changing the GST setting later never alters an invoice already issued. While still a draft, an invoice always shows totals for the current setting.

### Sending

From an invoice's page, a draft can be:

- **Send by email** — numbers the invoice, locks it, and emails the PDF to the recipient. If the email fails, the invoice still counts as sent (the email may have got through before the error), so use **Re-send** to try again or deliver it yourself.
- **Mark as sent (I'll deliver it)** — numbers and locks the invoice without emailing, for invoices you print, post or hand over.

A sent invoice can be **re-sent** by email at any time. Sent invoices can't be edited.

### Marking an invoice paid

When the money arrives, open the sent invoice and choose **Mark paid**. Payment is recorded in full — part-payments aren't supported. You have two options:

- **Link existing transaction** — if the payment is already in your transactions (for example from a bank-statement import), pick it from the list. The list only shows income transactions for exactly the invoice total, dated on or after the issue date and outside any locked period, that aren't giving and aren't already linked to another invoice. Linking moves the transaction to the invoice's income account and fund, so invoice income is always reported the same way however it was recorded.
- **Record new payment** — enter the payment date and the bank account it went into. This creates an income transaction for the invoice total, posted to the invoice's income account and fund, with the invoice number as its reference.

Tick **Email the recipient that payment was received** to send a short "payment received" note for the invoice to its email address. It is not a donation receipt — invoice payments are for goods or services, not gifts. If the email can't be sent, the invoice is still marked paid and the page tells you why.

The payment can't be dated before the invoice was issued, or fall in a locked accounting period. A paid invoice links to its payment transaction.

**Unmark paid** puts the invoice back to sent. The payment transaction stays in your books, just no longer linked to the invoice (a linked transaction keeps the invoice's account and fund). While a transaction is an invoice's payment, its amount, date, type, account and fund can't be changed and it can't be deleted — unmark the invoice first, then edit or delete it from Transactions.

### Voiding

A sent invoice that should never have been issued can be **voided** with a reason (for example "Duplicate" or "Wrong customer"). The number stays used, so the sequence has no gaps, and the invoice can no longer be paid or re-sent. To correct an invoice, void it and create a new one. A paid invoice must be unmarked before it can be voided. Drafts aren't voided — delete them instead.

### Totals and GST collected

Above the invoice list:

- **Outstanding** — the total of all sent, unpaid invoices.
- **Paid** — invoices marked paid in the period.
- **GST collected** — the GST on invoices paid in the period (shown only when the church is registered for GST). Use it as the invoice part of your BAS. It is **cash basis**: an invoice's GST counts in the period it was paid, not when it was issued. The ledger holds the GST-inclusive amount in the income account.

The period is the **Issued from / to** filter dates when both are set, otherwise the current month.

### Finding older invoices

The invoice list shows 50 invoices per page, newest issue date first. Use **Previous** and **Next** under the table to move between pages; the **Status** and **Issued from / to** filters stay applied as you page. The totals above the list always cover all invoices, not just the page shown.

### Numbering

Invoices are numbered `INV-0001`, `INV-0002`, … in the order they are sent. Numbers are only given out when an invoice is sent or marked as sent, so deleting drafts never leaves gaps.

### PDF download

**Download PDF** on an invoice's page saves the invoice as a PDF (`INV-0001.pdf`). Drafts can be downloaded too, marked with a large "DRAFT" watermark. Every download is recorded in the audit log.

## Who can do what

| Action | ADMIN | PASTOR | OFFICE_ADMIN | AUDITOR | VIEWER / EVENT_ORGANISER |
|---|---|---|---|---|---|
| View invoices and customers | Yes | Yes | Yes | Names, lines and totals only | No |
| See recipient email, phone and address | Yes | Yes | Yes | No | No |
| Download invoice PDF | Yes | Yes | Yes | No | No |
| Create, edit, send invoices; manage customers | Yes | Yes | No | No | No |
| Mark paid / unmark, void invoices | Yes | Yes | No | No | No |
| Change GST / payment-details settings | Yes | No | No | No | No |

## How it works

- `Invoice` and `Customer` models (`prisma/schema.prisma`). Recipient email/address and invoice notes, and customer email/phone/address/notes, are encrypted at rest — see [Data Encryption](/parishcrm/docs/data-encryption/).
- Money is held in integer cents while calculating; each GST line's GST is 10% of its line total, rounded to the cent. Totals are always computed on the server.
- Status moves `DRAFT → SENT → PAID` (or `SENT → VOID`); `PAID → SENT` when unmarked. Each change is checked against the expected current status, so two people acting on the same invoice at once can't both succeed.
- A payment is the income `Transaction` whose `invoiceId` points at the invoice (at most one per invoice). Marking paid flips the status and links or creates the transaction in one database transaction.
- The list pages with keyset cursors (`?after=` / `?before=`, each `YYYY-MM-DD_id`) over `issueDate desc, id desc`, so paging stays fast and stable as invoices are added. A malformed cursor is ignored and shows the first page.
- Every create, update, send, payment, unmark, void, delete and PDF download is written to the audit log.

## Related pages

- [Accounting Overview](/parishcrm/docs/accounting-overview/)
- [Receipts](/parishcrm/docs/receipts/)
- [Roles & Permissions](/parishcrm/docs/roles-and-permissions/)
