# Event fundraiser (food packets, part payments, reminders) — design

Date: 2026-11-12. Status: approved by PO 2026-11-12.

## Intent and why

A parish runs small offline food fundraisers (the example: "Pothichoru", packed meals). About 27
families or people each take some number of packets at a fixed price. Today the organiser writes
"who took how many × price" in a notebook and ticks off who has paid. Some families pay in two
parts. The organiser wants to track this in the CRM, and to email everyone with a balance a
reminder that lets them pay online or by bank transfer.

Why a new feature: events today only model public ticket registrations (`Registration` with a
single PENDING/PAID flag and a total). There is no staff-entered amount per person, no part
payment, no "what they took" line, and no collected-versus-outstanding total.

## Goals

- Under an event, a staff-only **Fundraiser** page lists one row per participant:
  name, quantity, unit price, amount owed, paid so far, remaining, status.
- Participants are picked from existing member families, or added as an outside person (name +
  email, no family link).
- Each row holds a list of **payments** (date, amount, method cash / bank / online, optional
  note). Paid so far, remaining and status (Unpaid / Part paid / Paid) are derived from the list.
- Top-of-page totals: expected, collected, outstanding.
- A **Send reminders** action emails everyone with a remaining balance: what they took, what
  they paid, what remains, a "Pay remaining by card" link, and bank transfer details with a
  per-participant reference. Fully paid rows are skipped.
- Card payment of the remaining balance, via the existing Stripe setup, records itself as a
  payment automatically. Bank payments are recorded by staff by hand.
- The first version is usable by one organiser entering about 30 rows.

## Non-goals

- No public sign-up form for the fundraiser. Staff enter every row.
- No automatic matching of bank-import lines to fundraiser payments (later, if wanted).
- No refunds, no discounts, no multiple items per row (one item type and one price per
  fundraiser). Several item types are a later extension.
- No change to how ticketed event registrations work.

## Anti-goals (a failure even if it technically works)

- A payment recorded twice (double-click, Stripe webhook retry) must not double-count.
- A reminder must never go to a fully paid participant, nor to someone with no email.
- Member or outside-person email must not be stored in plain text (see Constraints).
- The feature must not make the ticketed registration flow slower or riskier.

## Constraints

- Public AGPL repo: no real data in tests or fixtures; use the seeded demo users and synthetic names.
- Money is `Decimal(10,2)`, validated with the existing regex helper before any write (no inline
  `parseFloat`/`Number()`; a semgrep rule blocks it). Mirror `.claude/rules/database.md`.
- PII (outside-person email and phone) is AES-256-GCM encrypted at rest via `src/lib/crypto.ts`,
  with the existing blind-index pattern if equality lookup is needed. See `.claude/rules/encryption.md`.
- Every mutation is guarded at both the page and the Server Action (`src/lib/roleGuard.ts`),
  and written to the audit log (`src/lib/audit.ts`). See `.claude/rules/server-actions.md`
  and `.claude/rules/security.md`.
- Schema change goes through a Prisma migration; production applies `prisma migrate deploy`.
- Feature PR must also update the website docs page and any stale README claim.
- Many users are on phones: the list must work at 375px; keep desktop-only extras behind `xl:`.

## Decisions (as the PO decided them)

- Participants come from existing member families, plus the option to add outside people.
- Part payments are supported (typically two payments).
- A reminder email with online and bank payment options is wanted.

## Design (builder's calls)

Calls made during the conversation; approved by the PO.

1. **New models, not reuse of `Registration`.** `Registration` has a single status flag and is
   built around public checkout. Part payments need a payment list. Add:
   - `Fundraiser` (belongs to an `Event`; name, unit label such as "packet", unit price, optional
     bank reference prefix).
   - `FundraiserEntry` (belongs to a `Fundraiser`; optional `familyId`, or outside name +
     encrypted email/phone; `quantity`; `unitPrice` snapshotted at creation so a later price edit
     does not change existing rows; `publicToken` for the pay link).
   - `FundraiserPayment` (belongs to an entry; `amount`, `method` CASH | BANK | ONLINE, `paidAt`,
     optional note, optional unique `stripePaymentRef` for dedup, `recordedById`).
   - Reminder log row per send (twin of `PaymentReminderSend`: encrypted `sentTo`, status, error).
2. **Derived totals, not stored.** Paid and remaining are computed from payments, so edits and
   deletions can never leave them out of step. Status follows the same rule.
3. **Card payment reuses the existing Stripe checkout pattern.** The reminder's pay link opens a
   page keyed by the entry's `publicToken` (not a sequential id) that starts a checkout for the
   current remaining balance. The existing pay-now flow for a PENDING `Registration` is the model
   to follow. The webhook inserts an ONLINE payment, deduplicated on the Stripe reference. The
   card-fee gross-up setting applies the way it does for events, if the event has it on.
4. **Bank details in the email** come from the same church payment-details setting invoices
   already use (`src/lib/invoiceSettings.ts`). The reference is a short stable string per entry
   (builder chooses format, must be unique within the church).
5. **Reminders** reuse the existing email sending and the event-reminder patterns (idempotent,
   logged, failures recorded). The button shows how many people it will email; staff confirm.
6. **Where it lives:** a "Fundraiser" tab on the event page, plus a payments side panel or page
   per row. The mockup is at https://claude.ai/artifact/9NZpe7dB1TgTGyhMMxgw4u (sample data).
7. **Access (my call):** ADMIN, PASTOR and OFFICE_ADMIN can view and manage entries and record
   payments. AUDITOR can view totals only. VIEWER and EVENT_ORGANISER cannot. Recording a
   payment does not write a `Transaction` ledger row in version 1.

## More builder's calls (from the reviewer check; the PO can overrule)

- **Card payment is optional.** The pay link and card button show only when Stripe is configured
  and the event has online payment on. A fundraiser works with no Stripe at all (bank/cash only).
- **Member email is never copied.** The reminder reads the family members' `Person.email`,
  decrypted at send time. Only outside-person email/phone are stored on the entry (encrypted).
- **Overpayment:** staff entry that exceeds the remaining balance is rejected. A card payment that
  lands after the balance dropped (cash recorded while the checkout was open) is recorded in
  full, because the money was received, and the row shows an "Overpaid" flag for staff to refund.
- **Fee gross-up:** the recorded payment is the base amount, not the surcharge. The email shows
  the base remaining plus the card fee line when the event passes the fee on.
- **Editing:** quantity is editable. It cannot go below what is already paid (rejected). Price is
  snapshotted per entry and not editable after the first payment.
- **Deleting:** an entry with payments cannot be deleted (void it by setting quantity to the paid
  amount, or delete the payments first). Staff can delete a manual (cash or bank) payment, written
  to the audit log. Card (ONLINE) payments cannot be deleted in-app: refund them in Stripe, then
  ops corrects the ledger. An event with fundraiser entries cannot be deleted, so entries and
  payment history are never lost with the event.
- **Family merge and deletion (#650):** merging families moves the source family's entries to
  the target. If the target already has an entry in the same fundraiser at the same unit price,
  the two are combined (quantities summed, payments moved). Otherwise the entry stays as its own
  row, unlinked, showing the source family's name. Permanently deleting a family (only after the
  retention period) keeps its entries and payments, unlinked, with the family's name kept on them.
- **Reminders:** staff can resend any time. Each send is logged; the confirm dialog shows the last
  send date. No automatic scheduled reminders in version 1.
- **Duplicates:** one member family at most once per fundraiser (unique on fundraiser + family).
  Outside people are not constrained.
- **Webhook:** the existing Stripe webhook gets one new branch, keyed by a `fundraiserEntryId`
  metadata value, calling a separate function with its own tests. The ticket-registration path is
  not edited beyond the branch, to keep that flow safe.

## PO answers (2026-11-12)

- Ledger: fundraiser page only; no `Transaction` rows in version 1.
- One price per fundraiser (single item type).
- Access confirmed: ADMIN, PASTOR, OFFICE_ADMIN manage; AUDITOR views totals only.
- All builder's calls above approved.

## Left to the builder

File and component layout; exact column and enum names; email wording and template location;
bank reference format; migration naming; test structure; how to present the payments panel on
mobile.

## Done means

- Tests: totals and status derivation (unpaid / part / paid, overpay rejected or flagged),
  payment dedup, reminder skips paid and email-less rows, role guards, encryption round-trip.
- Manual check: create a fundraiser with member and outside rows, record two payments on one,
  send reminders, pay the remainder by Stripe test card, confirm status becomes Paid.
- `npm test` for touched suites, lint, `npx tsc --noEmit`.

## Rollback

Revert the PR and run a down migration that drops the new tables (`Fundraiser`,
`FundraiserEntry`, `FundraiserPayment`, `FundraiserReminderSend`) and also the column added to the
existing `CheckoutSession` table: `fundraiserEntryId`, with its foreign key and index.
