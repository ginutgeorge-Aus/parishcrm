---
title: "Membership Letters & Printing"
description: "Two print/PDF surfaces round out the membership workflow: a formatted copy of a submitted application (for filing or handing back to the applicant), and a…"
---

Two print/PDF surfaces round out the membership workflow: a formatted copy of a submitted application (for filing or handing back to the applicant), and a customizable welcome letter sent to a newly-enrolled family. Both are staff-only. See [Membership-Applications](/parishcrm/docs/membership-applications/) for how applications are reviewed and approved, and [Email-Notifications](/parishcrm/docs/email-notifications/) for how the letter is delivered by email.

## Using it

### Print a membership application

1. From an application's detail page (`/memberships/[id]`) or straight from a URL, open **Print form** — this opens `/memberships/[id]/print` in a new tab.
2. The print view reproduces the whole submitted form on the parish letterhead (name + address), including a signature image, a table of children/dependents/other relatives, and a blank "FOR OFFICE USE ONLY" block (registration number, book number, date, and a signature line for whoever the parish has configured as the signer) for staff to fill in by hand after printing.
3. Available to `ADMIN`, `PASTOR`, and `OFFICE_ADMIN` (`canEdit`) — `AUDITOR` and `VIEWER` cannot reach it directly, since it renders decrypted personal information.
4. Every print view is logged to the audit trail.

### Send a welcome letter

1. Open **Welcome Letter** in the sidebar (`/welcome-letter`), staff-only (`canEdit`).
2. Pick a family from the dropdown (non-archived families, alphabetical). This loads a pre-filled draft: today's date, membership number, addressee, address, greeting, the list of household members being welcomed, and the parish's standard intro/contributions/closing paragraphs — all editable inline before sending.
3. If the family includes a previous-church transfer (and the parish's "previous church" fields are enabled), a "transfer-certificate paragraph" checkbox is pre-ticked and mentions the church they transferred from; untick it to omit that sentence.
4. Bank account details for regular giving (general fund and building fund, each with bank/BSB/account number/account name) are pre-filled from parish settings but can be tweaked for this one letter without changing the saved defaults.
5. Click **Preview PDF** to open the rendered letter in a new tab before sending.
6. Under **Send to**, every household member with an email address on file is pre-selected (deselect as needed — a family member with no email on file isn't listed at all).
7. Click **Send welcome letter** to email the PDF to the selected recipients. A confirmation message reports how many recipients it went to.

## How it works

- **Print page**: `src/app/(print)/memberships/[id]/print/page.tsx` — server component, decrypts the application's payload/signature on the fly, reads church identity + membership settings + letter settings (for the office-use signer title), and renders a static print stylesheet (`@page { size: A4 }`). Guards: integer ID bounds check, `canEdit`, and a redirect to a 404 if the application's PII has already been purged by the retention job (see [Membership-Applications](/parishcrm/docs/membership-applications/)). Emits an audit log entry (`MEMBERSHIP_PRINTED`) with the requester's real client IP.
- **Welcome letter data model**: `src/lib/welcomeLetter.ts` (pure, no DB) builds a `WelcomeLetterModel` from a family's DB record, its member list (head first, by role), the parish's `LetterSettings`, and church identity — computing the addressee ("Head & Family"), city/state/postcode line, and an auto-generated enrolment sentence that mentions the membership number and, if applicable, the transferring church. `{churchName}`/`{memberNo}` placeholders in the admin's stored template text are substituted; any other `{token}` is left untouched so a typo is visible rather than silently blanked.
- **Draft/send actions**: `src/lib/actions/welcomeLetter.ts`.
  - `buildWelcomeLetterDraft(familyId)` — loads the family and its active (non-archived) members, decrypts address fields, and returns the model plus a `recipients` list (members who have an email on file).
  - `sendWelcomeLetter({ familyId, model, recipientPersonIds })` — re-resolves every recipient's email **from the database**, never trusting whatever the client posts back (defense against a tampered request adding an arbitrary address); renders the PDF (`src/lib/pdf/WelcomeLetterPdf.ts`) and sends it as an attachment via `sendWelcomeLetterEmail`. Logs `WELCOME_LETTER_SENT` (recipient count only — no member PII in the audit metadata).
  - The **Preview PDF** button calls `POST /api/welcome-letter/preview` with the in-progress model and opens the returned PDF blob — nothing is persisted or emailed by a preview.
- **Letter settings**: `src/lib/letterSettings.ts` — `AppSetting`-backed, cached (1h, tag-busted on save): two `BankAccount` slots (general fund, tax-deductible building fund — the tax-deductible flag is fixed per slot, not editable), signer name/title, and the three template paragraphs (intro/contributions/closing). Falls back to sensible generic default paragraphs when a parish hasn't customized them.

## Configuration

Both letterhead and letter defaults are set under **App Settings** (`/settings`, `ADMIN` only):

- **Letter Settings** section: bank account details (bank/BSB/account/name) for the general and building funds, signer name/title (used on both the welcome letter and the "FOR OFFICE USE ONLY" line on the printed application form), and the intro/contributions/closing paragraph templates.
- **Church Information** section: church name, address, ABN/registration number, email, website — used on both the membership-form letterhead image and the print header.
- The membership-form letterhead itself is served from `/api/branding/letterhead`, configured via the **Branding** section of Settings.
