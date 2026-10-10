---
title: "Email Notifications"
description: "Every outbound email in the app — password resets, one-time login codes, receipts, reminders, letters — goes through one small mail module (src/lib/email.ts)…"
---

Every outbound email in the app — password resets, one-time login codes, receipts, reminders, letters — goes through one small mail module (`src/lib/email.ts`) built on Gmail SMTP via `nodemailer`, or the Resend HTTPS API when `RESEND_API_KEY` is set (for hosts that block SMTP). This page catalogues what emails exist, when they're sent, and how delivery is made resilient. See [Membership-Applications](/parishcrm/docs/membership-applications/) and [Membership-Letters](/parishcrm/docs/membership-letters/) for the two membership-specific emails, and [Feedback-Widget](/parishcrm/docs/feedback-widget/) for the (separate) public-feedback notification path.

## Using it

Most of these emails are triggered automatically by app actions — there is no "send email" button for most of them. The exceptions a staff member drives directly:

- **Welcome Letter** (`/welcome-letter`) — see [Membership-Letters](/parishcrm/docs/membership-letters/).
- **Receipts** — sent from a transaction's detail page or in bulk from the accounting reports (single-receipt or batch send; batches skip any donor who hasn't given email consent).
- **Event reminders / payment reminders** — event reminders are sent automatically (see below), with no manual trigger (see [Event Reminders](/parishcrm/docs/event-reminders/)); payment reminders are manual only.
- **Birthday / anniversary emails** — an admin can send one manually from the relevant person/family record, or send a test copy to themselves from **Settings** to preview the current template.

An applicant or family member never needs to do anything to *receive* these emails beyond having a valid email address on file — delivery is entirely staff- or system-initiated.

## How it works

### The send chokepoint

`sendEmail()` and the type-specific `send*Email()` helpers (`sendPasswordResetEmail`, `sendFamilyUpdateInviteEmail`, `sendWelcomeEmail`, `sendMembershipNotificationEmail`, `sendWelcomeLetterEmail`, `sendRegistrationConfirmationEmail`, `sendEventReminderEmail`, `sendPaymentReminderEmail`, `sendReceiptEmail`, `sendDgrReceiptEmail`) all live in `src/lib/email.ts` and route every real send through a single internal function, `sendMailWithRetry`. No caller ever talks to the `nodemailer` transport directly. Retry behaviour depends on the provider.

With **Gmail SMTP** (the default), that chokepoint:

- Retries up to 3 times (short backoff) but **only** for errors that provably happened *before* the message reached the server (connection refused, DNS failure, TLS handshake failure, or a 4xx SMTP temporary-reject reply) — retrying after the server may have already accepted the message risks sending a duplicate.
- Treats certain socket errors (timeout, reset, broken pipe) as **ambiguous** — the message may or may not have gone out — and does *not* retry them; instead it fails the send and raises an "email delivery UNKNOWN" alert so a human checks before manually resending.

With **Resend** (`RESEND_API_KEY` set, `src/lib/resendTransport.ts`), each message carries one `Idempotency-Key` that is reused across its retries, so a retry can never deliver a duplicate. Because of that, Resend **does** retry timeouts, network errors, 429 (honouring `Retry-After`), 5xx replies, and `409 concurrent_idempotent_requests` (the original request under that key is still being processed). Only a timeout/network error or an in-flight 409 leaves delivery uncertain: if one of those happened and the retries run out, the send is reported as "delivery UNKNOWN". An exhausted run of 5xx/429 replies with no ambiguous attempt is reported as a plain failure.

With either provider, the chokepoint:

- On any exhausted/permanent failure, fires a best-effort alert email to the configured `ownerNotificationEmail` address (swallowing its own errors so an alert failure can never mask or loop on the original one).

Each email is a React Email component (`src/lib/emails/*.tsx`) rendered to both HTML and a plain-text fallback.

### What gets sent

| Email | Trigger | Notes |
|---|---|---|
| One-time login code (OTP) | New/untrusted device sign-in | Sent from the auth layer directly (not through the `send*Email` catalogue above, but through the same retry-safe path). Locks out after repeated failures; a delivery failure rolls back the just-issued code so the user isn't stuck behind a resend cooldown for a code that never arrived. |
| Password reset | "Forgot password" on the login page | Time-limited reset link. |
| Welcome / set-password | A staff account is created, or "resend welcome" is used | Includes a set-password link and a help link; body/subject are admin-customizable (see below). |
| Family self-update invite | Staff sends a family a secure link to review/update their own details | Admin-customizable body. |
| New membership application | A public application is submitted | Goes to the parish office (see [Membership-Applications](/parishcrm/docs/membership-applications/)) with the completed application PDF attached; no PII in the notification body itself, just a link into the review inbox. |
| Welcome letter | Staff sends a new-member welcome letter | PDF attached; see [Membership-Letters](/parishcrm/docs/membership-letters/). |
| Event registration confirmation | A public event registration completes | Includes an `.ics` calendar attachment when applicable. |
| Event reminder | Automatic scheduled sweep only | Upcoming-event nudge to registrants. |
| Payment reminder | Manual staff send only | Nudges registrants with an unpaid balance; amount is deliberately kept out of the subject line (PII-in-logs concern). |
| Receipt | Manual single/batch send from Accounting | Admin-customizable intro/signoff; the transaction description is never put in the subject (it's encrypted-at-rest PII, and subjects sit in plaintext in mail logs). |
| DGR (tax-deductible giving) receipt | Annual receipt generation | Attached PDF; admin-customizable subject/intro. |
| Birthday / anniversary blessing | Automatic daily sweep (opt-in per parish), or a manual per-person/bulk send | Skips anyone without email consent; the automatic sweep uses an idempotent claim so it can never double-send even if the cron fires twice. |
| Owner delivery-failure alert | Any of the above exhausts its retries or hits an ambiguous socket error | Goes to `ownerNotificationEmail`; distinguishes a confirmed failure from an "unknown, don't blindly resend" case. |

### Scheduled sends

Event reminders and birthday/anniversary emails are sent by the app's in-process scheduler, on by default in production (`IN_APP_CRON`). On a host that sleeps or scales to zero, set `IN_APP_CRON=false` and call the bearer-authenticated `/api/cron/*` endpoints from an external scheduler instead — see [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/).

### Customizable templates

Three of the emails (welcome, family-update invite, receipt) plus the birthday/anniversary blessings have their subject/intro/body/signoff text stored as editable `EmailTemplate` rows, changeable by an `ADMIN` under **Settings → Email Templates** / **Settings → Birthday & Anniversary emails**. Unknown `{tokens}` in admin-edited text are left as-is rather than silently blanked, so a typo is visible. These templates are boilerplate copy only — no PII is stored in them, and structural content (links, the receipt's line-item table) is always sourced from real typed data, never from the admin's free text.

## Configuration

| Env var | Purpose |
|---|---|
| `GMAIL_USER` | The Gmail address emails are sent from (also the church's fallback contact address). Required at boot unless local dev sets `DISABLE_OTP=true`. |
| `GMAIL_APP_PASSWORD` | Gmail app password for that account (not the account's normal login password) — see [Gmail Setup](/parishcrm/docs/gmail-setup/). |
| `RESEND_API_KEY` | Optional. Switches all mail to the Resend HTTPS API (port 443) instead of Gmail SMTP — needed where the host blocks SMTP, e.g. Railway Free/Trial/Hobby. Makes the Gmail pair optional. See [Gmail Setup](/parishcrm/docs/gmail-setup/). |
| `MAIL_FROM` | Required with `RESEND_API_KEY`: bare sender address on a Resend-verified domain. Replaces `GMAIL_USER` as the sender and fallback contact address. |
| `MEMBERSHIP_SECRETARY_EMAIL` | Fallback destination for the "new membership application" notification. Precedence: an `ADMIN`-set Settings value, then this env var, then `GMAIL_USER`. |
| `E2E_MOCK_EMAIL=true` | Test-only: swaps in an in-memory stub transport (logs the recipient only, never subject/body) so end-to-end tests don't need real SMTP. Inert in production. |

`ownerNotificationEmail` and `membershipSecretaryEmail` are set under **Settings → App Settings** (`ADMIN` only), not as env vars, for a live deployment — the env vars above are fallbacks/first-boot defaults.
