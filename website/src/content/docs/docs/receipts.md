---
title: "Receipts"
description: "ParishCRM sends two distinct kinds of receipt: a per-transaction email receipt (an acknowledgement that a specific gift or payment was recorded) and an annual…"
---

ParishCRM sends two distinct kinds of receipt: a **per-transaction email receipt** (an acknowledgement that a specific gift or payment was recorded) and an **annual DGR (tax-deductible gift) receipt** — a single formal PDF summarising every eligible donation a person made in a financial year, for their tax return. Every send of either kind is logged, and a dedicated **receipt audit** page lets an AUDITOR (or anyone with accounting access) review who was sent what.

## Using it

### Per-transaction receipts

From the transaction list or detail page (or the bulk **Send Receipts** screen at `/accounting/send-receipts`), ADMIN/PASTOR can email a receipt for one or more transactions to a chosen address — usually a family's on-file email, but any address can be typed in for a single send. A batch send can cover up to 200 transactions in one go and reports how many succeeded/failed with a reason for each failure.

- If the intended recipient's email-consent preference is off, the send is refused with an explicit "not consented" result rather than silently skipped — so an admin doing a batch run can see exactly who was excluded and why.
- Resending the *same* receipt to the *same* address again within about ten seconds is treated as a no-op (protects against a double-click), and a batch containing the same transaction/recipient pair twice only sends it once.
- A delivery failure is recorded (so a "why hasn't this receipt gone out" question can be answered from the record), but a failure to *log* an already-delivered send is never reported back as a failed send — the donor already has the email either way, so the app never tells an operator to resend something that actually went out.

### DGR (annual tax) receipts

`/accounting/dgr-receipts` — ADMIN/PASTOR. Create one receipt per donor per financial year: pick the person, confirm their email, and list each qualifying donation (date + amount + method) for that year — the app blocks any line dated outside the receipt's financial year and totals them automatically. Only one DGR receipt is allowed per donor per financial year (edit or delete the existing one instead of creating a duplicate).

- A **draft** can be freely edited or deleted.
- **Sending** renders a formal PDF (with the parish's legal/ABN details and the receipt's tax-deductibility wording) and emails it as an attachment; the receipt then moves to **sent** and is permanently frozen — it can no longer be edited or re-sent, since it's now a delivered legal document. A delivery failure moves it to **failed**, which (like a draft) can still be edited or retried.
- A donor's own view of their donation history is available separately to them via each email; staff never see a bulk unencrypted list of everyone's email on this screen — an individual donor's email is fetched and decrypted only when their receipt is being built.

### Receipt audit

`/accounting/receipt-audit` (`canViewAccounting` — ADMIN, PASTOR, AUDITOR, OFFICE_ADMIN) lists every per-transaction `ReceiptSend` attempt for a date range: recipient, status (success/failed), timestamp, and who triggered it. This is deliberately one of the few places an AUDITOR sees a decrypted donor email address — auditing exactly who a tax receipt was sent to is core to the receipt-audit function, so it isn't masked here (it *is* masked elsewhere in the app for the accounting-only AUDITOR role). Every view of this page is itself logged, for ADMIN/PASTOR as well as AUDITOR — bulk access to donor contact data always leaves a trail.

## How it works

### Data model

- **`ReceiptSend`** (`prisma/schema.prisma`): one row per per-transaction receipt attempt — `transactionId`, encrypted `sentTo`, `sentAt`, `sentById`, `status` (`SUCCESS`/`FAILED`), `errorMessage`. Written on every attempt, success or failure, so the audit trail is complete either way.
- **`DgrReceipt`**: `receiptNo` (a sequential, FY-scoped formatted number), `fyEndYear`, `seq`, `personId`, `donorName`, encrypted `donorEmail`, `lines` (JSON array of date/amount/method), `totalAmount`, `status` (`DRAFT`/`SENDING`/`SENT`/`FAILED`), `sentAt`/`sentById`.

### Sending is claimed, not just checked

A DGR send first atomically flips the row from `DRAFT`/`FAILED` to `SENDING` (a conditional update that only succeeds if it's still in one of those states) *before* doing the slow work of rendering the PDF and emailing it. This means a double-click or a retry racing the original send can't both succeed — only whichever request wins the claim proceeds, so a donor is never emailed the same annual receipt twice and a slow failure can't overwrite a fast success. A row stuck in `SENDING` because of a mid-send crash is recovered simply by editing it, which resets it back to `DRAFT`.

### Never logging the raw delivery error

Every failure path logs a stable, non-identifying message (and the numeric transaction/receipt id) — never the raw SMTP/mail-library error text, because that text can embed the recipient's actual email address. This keeps the parish's server logs from becoming an incidental store of donor PII.

### Financial year on a receipt

A DGR receipt's financial year is set once at creation and can't be changed afterward — editing a receipt re-validates every donation line still falls inside its *original* year, so a crafted or careless edit can't smuggle a next-year gift into an already-issued year's total. The year label itself adapts to the configured FY start month (see [Accounting Overview](/parishcrm/docs/accounting-overview/)): a July-start FY prints as "2025–26", a January-start install prints a single calendar year.

### Church identity and receipt wording

The parish name/address/ABN/email shown on both receipt types comes from Settings → Church Information (`AppSetting`), falling back to the `CHURCH_*` environment defaults until an ADMIN fills that in. The DGR receipt's document title, total-label wording, legal/tax-deductibility paragraph, and the "covered period" sentence are all editable per install in Settings, with a receipt numbering prefix (default `DGR`) — so the exact statutory wording for a given country/region can be customised without a code change.

## Configuration

| Variable | Purpose |
|----------|---------|
| `CHURCH_NAME`, `CHURCH_ADDRESS`, `CHURCH_ABN`, `CHURCH_WEBSITE` | Default parish identity shown on receipts until overridden in Settings |
| SMTP credentials (see the app's `.env.example`) | Outbound email delivery for both receipt types — required at boot unless local-dev OTP is disabled |

Receipt document wording (title, totals label, legal text, numbering prefix, covered-period sentence) is configured in-app under Settings, not via environment variables.
