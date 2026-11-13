---
title: "Event Fundraiser"
description: "Track a per-event fundraiser (for example packets of food sold for a feast): who ordered how many, part payments, reminder emails, and card or bank-transfer payment."
---

An event can have one **fundraiser**: a simple order book for something sold in units, such as
packets of food for a feast. Each row is a family (or an outside buyer) with a quantity. Staff
record what each row has paid, send reminder emails to those who still owe, and rows can pay the
remainder by card or bank transfer. This page is the staff how-to; see
[Events Overview](/parishcrm/docs/events-overview/) for events in general and
[Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) for the Stripe setup.

## Who can use it

| Role | Access |
|---|---|
| `ADMIN`, `PASTOR`, `OFFICE_ADMIN` | Full: set up, add and edit rows, record and delete payments, send reminders |
| `AUDITOR` | Read-only: sees the totals only (no names, no contact details) |
| `VIEWER`, `EVENT_ORGANISER` | No access |

The Events feature must be switched on. The tab is hidden otherwise.

## Setting it up

1. Open the event and choose its **Fundraiser** tab (`/events/[id]/fundraiser`).
2. In the settings form, enter:
   - **Name** (for example "Feast packets"), up to 120 characters.
   - **Unit label** (for example "packet"), up to 40 characters.
   - **Pickup price**, a positive amount with at most 2 decimals.
   - **Delivery price** (optional), same rules. Leave it empty if there is no delivery option.
   - **Bank reference prefix** (optional): letters and numbers only. It is upper-cased and
     used to build each row's bank-transfer reference, such as `FEAST0001`. Leave it blank for
     the default `FR`.
3. Save. There is one fundraiser per event.

Changing a price later only affects rows added afterwards. Each row keeps the price it
had when it was added.

### Pickup and delivery

When a delivery price is set, each row is either **Pickup** or **Delivery**. Pick one when adding
a row, and change it later from the row's Pickup/Delivery menu. Switching reprices the row at the
fundraiser's current price for the new choice, and is refused if the new total would be below what
the row has already paid. Any open card payment for the old amount is cancelled. You cannot clear
the delivery price while any row is a delivery. The buyer's payment page shows "(pickup)" or
"(delivery)" next to the price. Without a delivery price none of this appears.

## Adding rows

Click **Add** and choose one of:

- **Member family** - type at least two letters of the family name, pick the family from the
  matches, and enter the quantity. Families already on this fundraiser are not offered. A family
  can appear only once per fundraiser.
- **Outside buyer** - enter a name and a quantity, and optionally an email and phone. Outside
  contact details are encrypted at rest. Without an email the buyer cannot be sent reminders.

Quantity is a whole number from 1 to 9999. You can change a row's quantity later, but not below
what it has already paid. A row can be deleted only while it has no payments.

The totals strip at the top shows expected, collected and outstanding amounts. Each row shows a
status: **Unpaid**, **Part paid**, **Paid** or **Overpaid**.

## Recording payments

Open a row's payments panel and add a **cash** or **bank** payment with an amount, a date and an
optional note. A row can take several part payments. A payment cannot exceed the remaining
balance. A double-click does not create a second payment.

To correct a mistake, delete the manual payment and record it again.

## Card or bank transfer

- **Bank transfer**: the buyer pays into the parish account and quotes their row's reference.
  Staff then record the payment by hand (as above).
- **Card**: each row has a private pay link. When Stripe is configured and the event has online
  payment enabled, the reminder email and the link let the buyer pay the **remaining balance** by
  card. If the event passes on the card fee, the fee is added to the card total. The payment is
  recorded automatically when Stripe confirms it, and the row's status updates (for example to
  **Paid**).

Card payments are marked **Online**. **Online payments cannot be deleted or adjusted in the
app.** A refund must be made in the Stripe dashboard. The parish's no-refund policy still applies;
see [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/). After a refund or dispute, the
payment still counts as paid in the app. The app sends ops an alert, and whoever runs the server
must correct the fundraiser payment directly in the database.

## Sending reminders

Click **Send reminders**. The confirm dialog shows how many emails will go out, how many rows that
still owe money are skipped because they have no usable email, and when reminders were last sent.

- Rows that owe nothing are skipped.
- Member rows go to the first family member with an email address and email consent, preferring
  the head of the family. A row with no such person is skipped.
- Outside rows go to the outside email, if one was entered.
- Each email states the quantity, the amount owed, paid and remaining, the bank reference, and a
  card pay link when card payment is available.

You can send again at any time. Every attempt is logged with its status.

## Merged or deleted families

- **Merging two families** moves the merged-away family's fundraiser rows to the family that is
  kept. If that family already has a row in the same fundraiser at the same price, and the
  combined row stays within the per-entry limits ($999,999.99 owed, quantity 9999), the two rows
  are combined: quantities are added and the payments move across. The app then tries to cancel
  any open card checkout so it cannot be paid at the old amount; this is best-effort, so if Stripe
  fails to expire one, that old checkout may stay payable until it times out. The merged-away
  row's pay link and bank reference stop working, so use the kept row's (send a new reminder). The
  old bank reference is kept in the audit log, so a late transfer that quotes it can still be
  traced. If the prices differ, or the combined row would exceed either limit, the row is kept as
  a separate row under the merged-away family's name, no longer linked to a family. The merge
  preview warns about these rows, and the result screen lists them.
- **Permanently deleting a family** (allowed only after the retention period) keeps its
  fundraiser rows and payments. The rows show the family's name but are no longer linked to a
  family, so they get no member reminders. Keeping the name is deliberate: the fundraiser ledger
  is a financial record of who paid. On the rows, only the name is kept; no address, email, phone
  or member details. The reminder log for those rows also stays: each past reminder keeps the
  address it was sent to (stored encrypted), as a record of what was sent.

## Related

- [Events Overview](/parishcrm/docs/events-overview/)
- [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/)
- [Registrations Management](/parishcrm/docs/registrations-management/)
