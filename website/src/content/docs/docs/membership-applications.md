---
title: "Membership Applications"
description: "A public, unauthenticated form (/membershipform) lets a visitor apply to join the parish. Submissions land in a staff review inbox (/memberships) where an…"
---

A public, unauthenticated form (`/membershipform`) lets a visitor apply to join the parish. Submissions land in a staff review inbox (`/memberships`) where an editor either creates a brand-new family record from the application, merges it into an existing family, or rejects it. The form's optional fields (previous-church questions, an overseas/home-address field, an arrival-date field, a minimum monthly-dues amount) are all controlled by parish-specific settings, so a generic install can ship with a short, neutral form. See also [Membership-Letters](/parishcrm/docs/membership-letters/) for the welcome letter sent after a family is created, and [Email-Notifications](/parishcrm/docs/email-notifications/) for the notification email fired on submission.

## Using it

### Public applicant

1. Open `/membershipform` (linked from the parish website, not from the app's nav — it needs no login).
2. Fill in Section A (personal particulars — name, sex, date of birth, email, mobile, residential address, profession, marital status), Section B (spouse, optional), Sections C–E (children, other dependents, other relatives in Australia — each a repeatable row, up to 4/4/3 rows), and Section F (monthly subscription amount + declaration + a drawn signature).
3. If the parish has enabled "previous church" questions, extra fields appear for previous church, transfer-letter status, and spouse's church. If the parish has set an overseas-address label or an arrival-date label, those fields appear too — with whatever wording the parish chose (e.g. "Address overseas" / "Date of arrival"). Blank labels mean the field is hidden entirely.
4. A minimum monthly subscription may be enforced; the form shows it inline ("minimum $X") if configured.
5. If Cloudflare Turnstile is configured, a verification widget appears before submitting; if it fails to load, an inline message with the parish's contact email is shown instead of silently blocking the applicant.
6. Submit. On success the applicant is redirected to a plain "Thank you" confirmation page. No account is created and no further action is needed from the applicant.

### Staff review

1. Log in and open **Memberships** in the sidebar (`/memberships`). Available to `ADMIN`, `PASTOR`, and `OFFICE_ADMIN` (anyone `canEdit`); other roles are redirected away.
2. The inbox is tabbed by status — Pending / Approved / Rejected — with a pending count badge. Pending applications are listed oldest-first.
3. Open an application to see every section the applicant filled in, plus their drawn signature and any "Other details" notes block. A **Print form** link opens a formatted print view of the same data.
4. If the system finds existing families that plausibly match (same email, same mobile, or same surname), they're listed with a **Merge into this family** button — merging fills in only the family's *blank* fields (it never overwrites existing data) and appends the applicant's notes to the family's existing notes.
5. Otherwise (or in addition), click **Create new family** to enrol the applicant and their household as a brand-new family.
6. Click **Reject** to decline the application, optionally with a short reason note.
7. Once approved or rejected, the application becomes read-only ("This application has been approved/rejected").

## How it works

- **Model**: `MembershipApplication` (`prisma/schema.prisma`) stores the whole form as an encrypted JSON payload (`payload`), plus a separately-encrypted signature image (`signature`), the applicant's encrypted `email`/`mobile` with HMAC blind-index columns (`emailHash`/`mobileHash`) for equality matching, and plaintext `applicantName` (review-list display only), `monthlyDues`, `placeSigned`, `signedDate`. `status` is `PENDING` / `APPROVED` / `REJECTED`. On a decision, `reviewedById`, `reviewedAt`, and (on approval) `linkedFamilyId` are stamped.
- **Submit action**: `submitMembershipApplication` (`src/lib/actions/membership.ts`) — honeypot field check, signature presence/size check, Zod-validates the payload, re-checks the minimum-dues floor server-side (the client check is UX only), and rejects if the field labels the applicant saw are now stale (an admin changed them mid-fill — the client swaps in the fresh labels and the applicant re-submits without losing their answers). Cloudflare Turnstile is verified server-side. Rate-limited both per-IP and per-email (separate windows) via `dbRateLimit`. On success, the application row is created, and — fire-and-forget, never blocking the applicant's response — a PDF of the completed form is rendered and emailed to the parish office (see [Email-Notifications](/parishcrm/docs/email-notifications/)).
- **Matching**: `findMembershipMatches` (same file) looks up existing, non-archived `Person` rows by email hash, then mobile hash, then case-insensitive surname (capped to 10 results), de-duplicated by family. Gated to staff — it is a directly-callable server action, so without the role check it would let anyone enumerate families by guessing application IDs.
- **Approve**: `approveMembershipApplication(id, { mode: "create" | "merge", familyId? })`. Runs in a DB transaction that first atomically claims the application (`PENDING → APPROVED`, matching on `status: "PENDING"`) so two staff approving concurrently can't both succeed — the loser gets "This application has already been reviewed." In **create** mode it builds a unique family name (base name, then "First base", then "base (2)", "base (3)"...) and inserts the family plus one `Person` per household member (head, spouse, children, dependents) in a single batched `createMany`. In **merge** mode it only fills blank family fields, decrypts and re-concatenates the family's existing notes before re-encrypting, and only creates `Person` rows for household members not already present as *active* (non-archived) members — merging into an archived family is blocked outright.
- **Reject**: `rejectMembershipApplication(id, note?)` — same atomic-claim guard, stores an optional trimmed/capped rejection note.
- **Validation**: `membershipPayloadSchema` (`src/lib/membership.ts`) is the Zod schema for the whole payload; `readPayload`/`encryptPayload` handle the encrypt-whole-JSON-blob pattern (the `payload` column stores an AES-256-GCM-encrypted JSON *string*, not a nested JSON object).
- **PII & encryption**: `payload`, `signature`, `email`, and `mobile` are all encrypted at rest; `emailHash`/`mobileHash` are HMAC blind indexes used only for equality lookups (never for decrypting). The detail page and print page both refuse to render a purged application (see retention below) rather than crash trying to parse an emptied payload.
- **Retention / purge**: a decided (approved or rejected) application's PII — payload, signature, email, mobile, applicant name — is anonymised 24 months after the decision date; the decision itself (status, reviewer, review date, note, linked family, dues) is kept for the audit trail. Pending applications are never purged. The pure policy lives in `src/lib/membershipRetention.ts`; the script (`scripts/purge-membership-application-pii.ts`, dry-run by default, `--apply --yes` to write) is not scheduled by the app — run it yourself, ideally monthly (see [Privacy & Audit Log](/parishcrm/docs/privacy-and-audit-log/)). A purged application's detail/print pages show a simple "redacted" notice instead of the form.
- **Edge cases**: a rejected or already-approved application cannot be approved again; approving into an archived family is blocked; two concurrent approvals racing on the same generated family name retry once before surfacing a friendly error.

## Configuration

Settings live under **App Settings** (`/settings`, `ADMIN` only) in the **Membership** section, backed by `AppSetting` rows and read via `src/lib/membershipSettings.ts` (`getMembershipSettings`, cached, tag-busted on save):

| Setting | Effect |
|---|---|
| Ask for previous church, transfer letter and spouse's church | Shows/hides the "previous church" style fields on both the public form and the print/detail views |
| Minimum monthly dues ($) | Blank = no minimum; also pre-fills the dues amount when a staff member adds a new family elsewhere in the app |
| Overseas / home-country address field label | Blank = field hidden; any text = field shown with that exact label |
| Arrival date field label | Same pattern, for a date field |

Turnstile CAPTCHA (`TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`) is optional — set both to enable it on the public form, or leave unset to skip verification entirely (used this way in local/dev/tests).
