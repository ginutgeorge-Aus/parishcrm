---
title: "Settings & Branding"
description: "The Settings page (/settings, ADMIN role only) is where a church configures its identity, look, letters, and a handful of app-wide behaviours after first…"
---

The Settings page (`/settings`, `ADMIN` role only) is where a church
configures its identity, look, letters, and a handful of app-wide behaviours
after first login. Environment variables provide fallback defaults for some
of these fields until an admin saves a value in-app — see
[Environment Variables](/parishcrm/docs/environment-variables/).

## Using it

Sign in as an `ADMIN` and open **Settings** from the sidebar. Each section
below is its own form and saves independently.

### Church Information

Church name, address, tax/charity registration number, contact email, and
website — shown on donation receipts and public pages. Values here override
the `CHURCH_NAME` / `CHURCH_ADDRESS` / `CHURCH_ABN` / `CHURCH_WEBSITE`
environment fallbacks once saved.

Official financial documents (donation and tax receipts) require the name,
address, and registration number to actually be configured — the app refuses
to issue a receipt with the placeholder name or a blank address/registration
number, prompting the admin to finish Church Information first.

### Branding

Upload images that replace the built-in neutral placeholders everywhere they
appear — login screen, sidebar, public event pages, browser tab, and PDF
letterheads:

| Slot | Used for |
|---|---|
| Logo | Login screen + sidebar |
| Crest | Sidebar + event-organiser header |
| Crest (header) | Public event page header |
| App icon / favicon | PWA icon + browser tab |
| Letterhead | Banner across receipts and letters (PDF) |

Accepted formats are PNG, JPEG, and WebP only — SVG uploads are rejected
(serving arbitrary SVG same-origin is a stored-XSS risk). "Reset" restores
the neutral default for that slot. Uploaded images are stored in the
database, not on disk, so they survive container restarts/redeploys.

`THEME_PRIMARY` / `THEME_PRIMARY_DARK` / `THEME_ACCENT` environment
variables set the brand **colours** (see [Environment Variables](/parishcrm/docs/environment-variables/))
— there's no in-app colour picker; colours are deployment config, images are
admin-uploaded content.

### Welcome Letter

Bank account details (general fund and a second, tax-deductible fund),
default letter signer name/title, and the intro/contributions/closing
paragraph templates used when generating the new-member welcome letter PDF.

### Membership

Options for the public membership application form:

- Whether to ask for previous church, transfer letter, and spouse's church
  (toggle)
- Minimum monthly dues amount (also pre-fills dues when adding a family
  manually)
- Custom field label for an overseas/home-country address (blank = don't ask)
- Custom field label for an arrival date (blank = don't ask)

### Birthday / Anniversary emails

Subject and body templates for automated birthday and wedding-anniversary
emails, plus on/off toggles for each.

### App Settings

- **Login notification email** — receives an alert on failed login attempts;
  blank disables it.
- **Membership secretary email** — where public membership-form
  notifications go (see `MEMBERSHIP_SECRETARY_EMAIL` fallback).
- **Session idle timeout** — minutes of inactivity before a session expires.
- **Card processing fee (%  and fixed)** — the percentage and fixed
  cost-of-acceptance surcharge passed on for card-paid event tickets, when
  card payments are enabled (see [Card Payments (Stripe)](/parishcrm/docs/card-payments-stripe/)).

### Email Templates

Editable subject/body templates for the app's transactional emails
(receipts, reminders, notifications) — see
[Email Notifications](/parishcrm/docs/email-notifications/).

### Receipts

Donation-receipt wording and options — see [Receipts](/parishcrm/docs/receipts/).

### About

Read-only footer showing the running app version and (if set) the short git
commit SHA, from `NEXT_PUBLIC_APP_VERSION` / `NEXT_PUBLIC_GIT_SHA`.

## How it works

- Most Settings fields are stored as rows in an `AppSetting` key/value table,
  read at request time (a short-lived cache backs the church-identity read
  path so a Settings save is picked up quickly).
- Branding images are stored as binary blobs in a `BrandingAsset` table
  (one row per slot) and served through `/api/branding/<slot>`, which returns
  the neutral placeholder SVG when no row exists yet.
- The web app manifest (used for "Add to Home Screen") reads the current
  church name and the uploaded icon at request time, so a PWA install picks
  up the church's own name and icon rather than a generic one — see
  [Help and What's New](/parishcrm/docs/help-and-whats-new/) for PWA install notes.
- Theme colours are read once at process start from `THEME_*` env vars and
  applied consistently across the UI, generated PDFs, and transactional
  emails, so a redeploy with new values changes everything at once. Colours
  are **not** editable in-app — that keeps a single container image usable
  for any church without a rebuild.

## Configuration

| Variable | Effect |
|---|---|
| `CHURCH_NAME`, `CHURCH_ADDRESS`, `CHURCH_ABN`, `CHURCH_WEBSITE` | Fallback values shown until Church Information is saved in-app. |
| `THEME_PRIMARY`, `THEME_PRIMARY_DARK`, `THEME_ACCENT` | Brand colours, hex `#RRGGBB`. |
| `MEMBERSHIP_SECRETARY_EMAIL` | Fallback membership-form notification address. |

See the full reference at [Environment Variables](/parishcrm/docs/environment-variables/).

## Related pages

- [Regional Configuration](/parishcrm/docs/regional-configuration/)
- [Membership Applications](/parishcrm/docs/membership-applications/)
- [Membership Letters](/parishcrm/docs/membership-letters/)
- [Email Notifications](/parishcrm/docs/email-notifications/)
- [Receipts](/parishcrm/docs/receipts/)
- [Roles and Permissions](/parishcrm/docs/roles-and-permissions/)
