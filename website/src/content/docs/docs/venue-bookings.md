---
title: "Venue Bookings"
description: "For churches that hire another parish's church or hall: plan dated bookings, ask the venue to book them, email a monthly invoice request (by hand or automatically), and share a no-login committee calendar."
---

Venue Bookings is for a church that does not own its building and hires another parish's church or hall. You plan the dates, ask the venue to book them, then email the venue once a month asking for an invoice for the hours you used. The venue's invoice is recorded as a normal expense, as usual.

## Who it is for

Use it if your congregation meets in a building run by someone else, for example a hall called "Example Hall". Churches with their own building can leave it switched off. It is off by default, and nothing in this page appears anywhere until it is turned on.

## Turn it on

Go to **App Settings → General → Venue bookings** (`ADMIN` only):

- **Enable venue bookings** adds a **Venue bookings** page to the sidebar for editors. It needs a contact email before it can be enabled.
- **Venue name**, for example "Example Hall".
- **Contact name** (used in the greeting) and **Contact email** (where requests are sent).
- **Invoice request CCs** (optional), up to 10 addresses separated by commas, copied on the monthly invoice request. An invalid address is rejected when you save.
- **Booking request CCs** (optional), up to 10 addresses separated by commas, copied on booking requests and cancellation notices. An invalid address is rejected when you save.
- **Reply-to email** (optional): where the venue's reply (the invoice) goes. Leave it blank to use the email of whoever sends the request.

## Booking dates

Open **Venue bookings** in the sidebar and pick a month. Each date has a status:

| Status | Meaning |
|---|---|
| Requested | Planned, not yet confirmed by the venue. Not counted in the invoice. |
| Confirmed | The venue has agreed. Only confirmed dates are counted in the invoice. |
| Cancelled | Dropped. Kept on the list but not counted. |

- **Add a booking** takes a date, status, start and end time, an optional purpose and optional notes. A future date starts as Requested; today or a past date starts as Confirmed.
- **Add all Sundays in** the chosen month creates a booking for every Sunday that does not already have one.
- Tick several rows to **Mark confirmed** or cancel them together.
- **Cancel** asks "Email venue about this cancellation?". Choose to email the venue, or keep the booking change without emailing. The cancellation notice wording is fixed.
- Once a date has been sent to the venue in a booking request, its date and times are locked. To change it, cancel it from the list (emailing the venue) and add a new booking. Purpose, notes and status can still be edited, but cancelling goes through the list so the venue can be told.
- After the day, **Edit** the booking so it shows the times you actually used. The total hours for the month is shown above the list.

## Asking the venue to book

The **Send booking request** panel lists the Requested dates the venue has not been asked about yet. Tick the ones to include. The preview shows the email, including a list of dates the venue has already confirmed for reference, so they can spot clashes. Dates that were already asked about show "asked on" with the date. Sending records when each date was asked, so the next request only includes new dates.

## Monthly invoice request

The **Request invoice** panel emails the venue asking for an invoice for a month. It counts confirmed dates only, and shows the number of bookings, the total hours and the email preview first. Warnings appear if something looks wrong, for example a month with no confirmed dates, a Sunday that is neither confirmed nor cancelled, or dates still Requested.

Click **Send request** to send it now, or **Send again** if a request for that month already went out. Both ask for confirmation first. Sends are blocked on the public demo.

When the venue replies with their invoice, record it as an ordinary expense in [Transactions](/parishcrm/docs/transactions/).

## Automatic send

You can approve the **current month** so the app sends the request for you.

1. Make the month complete: every Sunday is confirmed or cancelled, nothing is Requested, and at least one date is confirmed.
2. In **Request invoice**, click **Approve automatic send on 1 *next month*, 9:00 AM** and confirm. The email is built again when it is sent, so it always lists the dates as they stand then. Changing a date clears your approval, so the dates you approved are the dates that go out. Edits to the email template or the venue contact settings before the send do change the wording or recipient.
3. On the first of the next month, from 9:00 AM Sydney time, the app sends the request and emails the editors a notice that it went out.

Details:

- **Any change clears the approval.** Adding, editing, deleting, confirming or cancelling a date in that month removes the approval and shows "Approval cleared — dates changed, please re-approve." Approve again once the month is complete.
- **Withdraw approval** removes it at any time before the request is sent.
- **Not approved, or no longer complete:** nothing is sent to the venue. Instead the editors get a reminder email explaining why, and a link to the page, so someone can fix the dates and click **Send request**.
- **Who is emailed:** active `ADMIN`, `PASTOR` and `OFFICE_ADMIN` users get the sent notice or the reminder, either way.
- **Timing:** the job's window is the Sydney 1st to the 7th, from 9:00 AM each day, and the first send is at 9:00 AM on the 1st. If the app is offline on the 1st, the job catches up later in the first week. It sends once per month, with at most 3 attempts per Sydney day, 30 minutes apart. The attempt budget refreshes each day. **Send request** is still available at any time. See [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/).

## Committee calendar

The **Committee calendar link** box gives a secret link of the form `/venue/<token>` that anyone can open without logging in, for example to share with the church committee.

- It shows the venue name, dates, times and purpose, labelled **Confirmed** or **Pending**. Cancelled dates are hidden.
- It never shows notes, names or any other CRM data. Search engines are asked not to index it.
- The page can show 12 months back and 6 months ahead.
- Any editor can copy the link. An `ADMIN` creates it the first time and can **Reset link** at any time. Resetting makes the old link stop working immediately, so share the new one.
- A wrong or old link, or the feature being switched off, shows "not found".

## Email wording

Under **App Settings → Email** (see [Settings and Branding](/parishcrm/docs/settings-and-branding/)), two templates are editable: **Venue booking request** and **Venue invoice request**. They can use these variables: `{venueName} {contactName} {churchName} {month} {dates} {bookedDates} {totalHours} {senderName}`. The cancellation notice wording is fixed. See [Email Notifications](/parishcrm/docs/email-notifications/) for the full list of emails.

## Roles

| Role | Access |
|---|---|
| `ADMIN` | Everything, including the settings and creating or resetting the calendar link |
| `PASTOR`, `OFFICE_ADMIN` | Manage bookings, send requests, approve and withdraw automatic sends |
| `AUDITOR`, `VIEWER`, `EVENT_ORGANISER` | No access |

See [Roles and Permissions](/parishcrm/docs/roles-and-permissions/).

## Audit

Every booking change, approval, cleared approval, withdrawal, send, cancellation email and link reset is recorded in the audit log, using ids, counts and month keys only. Email addresses, notes and the calendar link itself are never written to it. See [Privacy and Audit Log](/parishcrm/docs/privacy-and-audit-log/).
