---
title: "Family Self-Update"
description: "Lets a family review and correct their own contact details and member list through a one-time emailed link, without needing a login. Staff review every…"
---

Lets a family review and correct their own contact details and member list through a one-time emailed link, without needing a login. Staff review every submission before it's applied — nothing a family submits changes the database automatically.

## Using it

**Nav:** from a family's detail page (`/families/[id]`), an editor clicks **Send self-update invite** and enters the destination email address. The recipient gets an email with a link to `/family/update/[token]` — a public page (no login) pre-filled with that family's current address, phone, marriage date, and each member's name/gender/date of birth/email/mobile/phone.

The family reviews the pre-filled form, makes any corrections, and submits. They then see a "thank you, awaiting review" message — the link becomes single-use at that point.

### Reviewing submissions
**Nav:** *Families → Family updates* (`/families/updates`), visible to editors (ADMIN/PASTOR/OFFICE_ADMIN). Lists pending submissions; opening one (`/families/updates/[id]`) shows a diff-style view of what the family submitted versus current records. The reviewer can:
- **Approve** — applies the submitted changes to the family and its members.
- **Reject** — discards the submission, optionally with a note, and closes out the invite (the public link then shows "no longer valid").

Only one unreviewed submission is allowed per family at a time — sending a new invite is blocked while an earlier one is still pending, so two submissions can never be approved out of order and overwrite each other.

### Roles
| Role | Access |
|------|--------|
| `ADMIN`, `PASTOR`, `OFFICE_ADMIN` | Send invites, review/approve/reject submissions |
| `AUDITOR`, `VIEWER`, `EVENT_ORGANISER` | No access to invite/review screens |
| Public (no login) | Can only open a valid, unexpired, unused token link and submit the form once |

## How it works

### Data model
- `FamilyUpdateInvite`: `familyId`, `tokenHash` (unique — the raw token is never stored), `email` (destination, encrypted), `status` (`SENT` / `SUBMITTED` / `REVOKED`), `expiresAt` (14-day TTL from send), `createdById`.
- `FamilyUpdateSubmission`: `familyId`, `inviteId`, `payload` (the submitted form data, JSON, encrypted as a string blob), `status` (`PENDING` / `APPROVED` / `REJECTED`), `reviewedById`, `reviewedAt`, `reviewNote`.

### Sending an invite (`src/lib/actions/familyActivity.ts` / `familyUpdate.ts::sendFamilyUpdateInvite`)
`canEdit`-gated. Generates a random token, stores only its hash, and builds the public link from the app's configured base URL — validated before anything else changes, so a misconfigured server URL can't leave a family with a dead invite and no way to know it failed. Any previously outstanding `SENT` invite for the family is revoked first, so only one live link can exist at a time. Audited as `FAMILY_INVITE_SENT`.

### The public page (`src/app/(public)/family/update/[token]/page.tsx`)
No authentication — reachable by anyone who has the link. Deliberately marked `noindex, nofollow` since it exposes a family's PII to whoever holds the token. It only ever selects the specific columns the form pre-fills (never pastoral notes, emergency contact, banking name, or the blind-index hash columns). An expired, revoked, or already-submitted token shows a generic notice rather than any family data. A family archived after the invite was sent is treated the same as an invalid link.

### Submitting (`submitFamilyUpdate`)
Defends against automated abuse: a honeypot field (a hidden input real users never fill), a signed timing token that rejects too-fast/stale/forged submissions, and a rate limit (5 submissions per IP per 10 minutes). The status flip from `SENT` to `SUBMITTED` happens atomically inside the same transaction that creates the `FamilyUpdateSubmission` row, so two near-simultaneous submissions on the same link can't both succeed — the second one loses the race and is told the link is no longer valid. The submitted payload is stored **encrypted** (`encrypt(JSON.stringify(payload))`), not as plaintext JSON.

### Approving (`approveFamilyUpdate`)
`canEdit`-gated. Re-validates the stored payload through the same schema used at submission (defence in depth — it's still untrusted input even coming from the database). The PENDING→APPROVED status flip is claimed atomically first, so two reviewers can't both approve the same submission and double-apply it or create duplicate members. For each submitted member: if it carries an existing `personId`, the corresponding `Person` row is updated (scoped to still belong to this family and not be archived, so a stale or reassigned id can't silently overwrite the wrong record); otherwise a new `Person` is created. A submitted member whose referenced person was deleted or moved to another family between submission and review produces a clear "no longer exist, ask the family to resubmit" error rather than a crash. Approving is audited as `FAMILY_UPDATE_APPROVED`, and `familyActivity.ts::getFamilyLastUpdate` uses that audit entry (with the invite's masked destination email) to show "last updated via self-update invite" on the family page.

### Rejecting (`rejectFamilyUpdate`)
Same atomic PENDING→REJECTED claim, with an optional review note (max 1000 chars). Also revokes the associated invite in the same transaction, so the public link consistently shows "no longer valid" afterward rather than continuing to display an unresolved "awaiting review" message.

### Encryption
The invite's destination `email` and the submission `payload` (the entire submitted form as JSON) are both encrypted at rest. Member contact fields inside the payload (email, dateOfBirth, mobile, work/home phone) are individually encrypted again when written to the `Person` record on approval, with the email/mobile blind-index hashes recomputed at that point — identical to the encryption rules that apply to any other person edit.

## Configuration

- The public link is built from the app's base URL setting (`AUTH_URL`) — if unset or invalid, sending an invite fails cleanly rather than emailing a broken link.
- Invite links expire 14 days after being sent (fixed, not configurable per-parish).
