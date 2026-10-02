---
title: "Privacy and Audit Log"
description: "ParishCRM ships a public privacy policy page, an append-only audit log covering the sensitive actions staff take, and scheduled purges of personal information…"
---

ParishCRM ships a public privacy policy page, an append-only audit log covering the
sensitive actions staff take, and scheduled purges of personal information that has passed
its retention window. This page covers all three. See [Data-Encryption](/parishcrm/docs/data-encryption/) for how the
underlying fields are protected, and [Roles-and-Permissions](/parishcrm/docs/roles-and-permissions/) for who can see what.

## Using it

- The privacy policy is public at `/privacy` — reachable without logging in, since privacy
  legislation typically requires it be visible to anyone, not just members.
- Anyone with accounting access can view relevant audit trail entries where the UI surfaces
  them (e.g. who sent a receipt, and to what address, on the receipt-audit and transaction
  pages).
- An ADMIN can export a full JSON record of a person's stored data via the person export
  feature — used to respond to an access request.
- Retention purges run automatically on a schedule; there's no manual "purge now" button in
  the UI. See **How it works** for what's purged and when.

## How it works

**Privacy policy page.** `src/app/(public)/privacy/page.tsx` renders a static policy
covering what's collected, how it's used, who it's disclosed to (third-party processors used
to run the app — CAPTCHA, payment processing, hosting/email delivery), retention periods,
and how to request access or correction. It pulls the parish's own name and contact email
from in-app settings rather than being hardcoded, and it's on the public-path allowlist (see
[Security-Model](/parishcrm/docs/security-model/)) so it loads without authentication.

**Audit log.** Every sensitive action — user creation/edit/unlock/delete, sign-in and failed
sign-in, accounting mutations and financial-report views/exports, bulk data exports,
CSV/bank-statement imports, pastoral-note views, receipt sends, trusted-device grants — is
written to an append-only audit table via a single `logAudit(userId, action, resourceType,
resourceId?, metadata?, ip?)` helper (`src/lib/audit.ts`). The write never throws back into
the calling request — a database outage or schema drift must not take down the primary
action the user was performing — but a failed audit write is itself logged, so a systemic
audit-logging failure doesn't go silently unnoticed. The recorded IP address is always the
one derived from the trusted reverse proxy's header position, never a raw, client-spoofable
value.

**What's deliberately *not* logged.** Metadata is scoped to avoid duplicating the very PII
the log exists to hold accountable access to — for example, a person-record update logs
which family the person belongs to, not the person's new phone number or notes content.

**Read access to audit data.** Audit entries aren't generally browsable as a raw log by
non-admins; specific views surface relevant slices to the roles that need them — for
example, accounting roles (including `AUDITOR`) can see who a giving receipt was emailed to
and when, as part of receipt-audit accountability, without being able to see broader member
PII (see [Roles-and-Permissions](/parishcrm/docs/roles-and-permissions/) for why `AUDITOR` is excluded from people/family records
generally).

**PII retention purges.** Two scheduled scripts anonymise personal data once it's no longer
needed for its original purpose, while preserving the aggregate figures accounting still
needs:

- **Event registration data** — six months after an event ends, registrant and attendee
  contact details, names, and free-text custom-question answers (dietary/medical/
  accessibility/emergency-contact information) are scrubbed from registrations, the
  waitlist, and any lingering checkout-session payloads for that event. Financial aggregates
  (amounts, quantities, payment status, timestamps) are left untouched, since those are still
  needed for financial record-keeping.
- **Membership applications** — once an application has been decided (approved or rejected)
  and that decision is older than the retention window, its encrypted payload, signature
  image, and contact details are scrubbed. Applications still awaiting a decision are never
  touched. The decision itself (status, who reviewed it, when, any review note) is preserved
  so the historical record of *that a decision was made* survives even though the underlying
  personal data doesn't.

Both purges are idempotent — each table tracks its own "already anonymised" marker so
re-running the script is a no-op for rows already handled — and dry-run by default, requiring
an explicit apply flag to actually write. They're intended to run on a recurring schedule
(monthly) against the production database.

**Data access/correction requests.** The privacy policy directs data-subject requests to the
parish office. Operationally, an ADMIN can produce a full JSON export of a person's stored
data (contact details, family, financial giving history, etc.) for exactly this purpose; the
export action itself is audit-logged.

**Read-only integrity check.** A separate diagnostic script (not a purge) scans every field
that's supposed to be encrypted at rest and checks it actually is, checks the email
blind-index is complete, and verifies a handful of invariants the database schema can't
enforce on its own. It changes nothing — it's meant to be run periodically against
production (or a restored backup) as a health check, exiting non-zero if it finds anything
wrong.

## Configuration

| Variable | Purpose |
|---|---|
| `CHURCH_NAME` / in-app "Church Information" settings | Populates the parish name shown on the privacy policy page. In-app settings take precedence over the environment fallback. |
| `GMAIL_USER` / equivalent contact settings | Sourced for the "contact the office" details shown on the privacy page. |

Retention windows (how long after an event, or after a membership decision, data is purged)
and the audit log's action list are fixed in code, not environment-configurable — see
`src/lib/registrationRetention.ts`, `src/lib/membershipRetention.ts`, and the `logAudit` call
sites throughout `src/lib/actions/` for the authoritative list of what's tracked.
