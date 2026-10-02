---
title: "Gmail Setup"
description: "ParishCRM sends every email — sign-in codes, receipts, reminders, letters — through Gmail SMTP (see Email Notifications). It needs two settings: GMAIL_USER…"
---

ParishCRM sends every email — sign-in codes, receipts, reminders, letters —
through Gmail SMTP (see [Email Notifications](/parishcrm/docs/email-notifications/)). It needs
two settings: `GMAIL_USER` and `GMAIL_APP_PASSWORD`. If your host blocks SMTP,
use [Resend instead](#host-blocks-smtp-use-resend-instead).

## Which account

Any Gmail or Google Workspace account works, **as long as it can create an app
password**. A dedicated church account is better than a personal one:

- Members see it as the sender of every email.
- The app password grants full access to that mailbox.

App passwords are **not available** for:

- Accounts in Google's Advanced Protection Program.
- Accounts whose 2-Step Verification uses only security keys.
- Workspace (work/school) accounts whose admin has disabled app passwords.

## Create the app password

Google rejects SMTP sign-in with the account's normal password, so this step is
required.

1. Sign in to the Gmail account and turn on **2-Step Verification**
   (Google Account → Security).
2. Open <https://myaccount.google.com/apppasswords>.
   If it says "not available", the account is one of the exceptions above —
   use another account.
3. Create an app password named `ParishCRM` and copy the 16 characters.
4. Set:
   | Variable | Value |
   |---|---|
   | `GMAIL_USER` | The Gmail address, e.g. `yourchurch@gmail.com` |
   | `GMAIL_APP_PASSWORD` | The 16-character app password, without spaces |
5. Restart / redeploy the app, then sign in — a login code should arrive from
   that address.

On Railway, set both on the app service's **Variables** tab. For Docker, put
them in `.env` (see [Installation](/parishcrm/docs/installation/)).

## Limits and safety

- **Daily sending limit:** roughly 500 emails/day on consumer Gmail, about
  2,000 on Workspace. Sign-in codes never come close; a large reminder or
  birthday/anniversary batch can.
- **Never commit** the app password to a repository or paste it into a shared
  template.
- **If it leaks:** revoke it at the same page and create a new one — nothing
  else in ParishCRM needs rotating.

## Host blocks SMTP? Use Resend instead

Gmail sends over SMTP. Some hosts block outbound SMTP — **Railway blocks it on
its Free, Trial and Hobby plans**, so sends time out and nobody receives a
login code. Use [Resend](https://resend.com), which sends over HTTPS (port 443):

1. Create a Resend account and **add your domain** (Domains → Add). Add the
   SPF and DKIM DNS records it shows at your DNS provider, then wait for
   **Verified**.
2. Create an API key (API Keys → Create, permission **Sending access**).
3. Set:
   | Variable | Value |
   |---|---|
   | `RESEND_API_KEY` | The Resend API key |
   | `MAIL_FROM` | A bare address on the verified domain, e.g. `noreply@yourchurch.org` |
4. Redeploy. Setting `RESEND_API_KEY` switches **all** mail to Resend; the
   `GMAIL_*` pair can be removed.

- Without a verified domain, Resend only allows `onboarding@resend.dev` as
  `MAIL_FROM`, and only delivers to your own Resend account address — enough
  to test the first login, not for real use.
- Free tier: 100 emails/day, 3,000/month.
- `MAIL_FROM` is also the fallback church contact address and membership
  notification destination. A send-only `noreply@` address receives nothing —
  use a monitored mailbox, or set **Settings → Church Information** email and
  **Settings → App Settings → Secretary email address(es)** after first login.

## Related pages

- [Email Notifications](/parishcrm/docs/email-notifications/)
- [Environment Variables](/parishcrm/docs/environment-variables/)
- [Installation](/parishcrm/docs/installation/)
