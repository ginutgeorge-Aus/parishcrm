---
title: "Invoices"
description: "Create, send and track invoices to church members or outside customers — hall hire, venue fees and other charges — with optional GST tax invoices and PDF download."
---

Invoices let the church bill someone for a charge — hall hire, a venue fee, a camp fee — and keep track of whether it has been paid. An invoice can go to a **church member** (picked from People) or to a saved **customer** (an outside person or organisation, such as a community group that hires the hall). Customers are kept separate from People, so they never appear in the member directory, member counts or member emails.

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

Whether an invoice is a tax invoice is fixed when it is sent, so changing the GST setting later never alters an invoice already issued.

### Sending

From an invoice's page, a draft can be:

- **Send by email** — numbers the invoice, locks it, and emails the PDF to the recipient. If the email fails, the invoice stays a draft (keeping its new number) and you can try again or mark it as sent instead.
- **Mark as sent (I'll deliver it)** — numbers and locks the invoice without emailing, for invoices you print, post or hand over.

A sent invoice can be **re-sent** by email at any time. Sent invoices can't be edited.

### Numbering

Invoices are numbered `INV-0001`, `INV-0002`, … in the order they are sent. Numbers are only given out when an invoice is sent or marked as sent, so deleting drafts never leaves gaps. A draft that already received a number (because its email failed) can't be deleted.

### PDF download

**Download PDF** on an invoice's page saves the invoice as a PDF (`INV-0001.pdf`). Drafts can be downloaded too, marked with a large "DRAFT" watermark. Every download is recorded in the audit log.

## Who can do what

| Action | ADMIN | PASTOR | OFFICE_ADMIN | AUDITOR | VIEWER / EVENT_ORGANISER |
|---|---|---|---|---|---|
| View invoices and customers | Yes | Yes | Yes | Names, lines and totals only | No |
| See recipient email, phone and address | Yes | Yes | Yes | No | No |
| Download invoice PDF | Yes | Yes | Yes | No | No |
| Create, edit, send invoices; manage customers | Yes | Yes | No | No | No |
| Change GST / payment-details settings | Yes | No | No | No | No |

## How it works

- `Invoice` and `Customer` models (`prisma/schema.prisma`). Recipient email/address and invoice notes, and customer email/phone/address/notes, are encrypted at rest — see [Data Encryption](/parishcrm/docs/data-encryption/).
- Money is held in integer cents while calculating; each GST line's GST is 10% of its line total, rounded to the cent. Totals are always computed on the server.
- Status moves `DRAFT → SENT`; each change is checked against the expected current status, so two people acting on the same invoice at once can't both succeed.
- Every create, update, send, delete and PDF download is written to the audit log.

## Related pages

- [Accounting Overview](/parishcrm/docs/accounting-overview/)
- [Receipts](/parishcrm/docs/receipts/)
- [Roles & Permissions](/parishcrm/docs/roles-and-permissions/)
