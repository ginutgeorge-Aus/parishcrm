# Sunday School parent registration form (OSS-16) - design

Status: draft for PO review, 2026-11-15. Builds on OSS-9 (classes/enrolment), OSS-10/12 (roll, exams) and
reuses the public membership form (`MembershipApplication`) and public prayer form (#702) patterns.

## Goal

A parent opens a public page, enters their own details and one or more children, and submits. Staff review
the request, link it to an existing family or create one, and approval creates the child `Person` records and
(optionally) enrols each child in a class. Nothing reaches `Person`/`Family`/`SundaySchoolEnrolment` until a
staff member approves. All personal data is encrypted at rest. Done when: a public submit creates one
`PENDING` request, a reviewer can approve/reject it, and approve is atomic, idempotent and audited.

## User flows

**Parent (no login)**
1. Opens `/sunday-school/register` (route group `(public)`, sibling of `membershipform`). Page shows a generic
   "not available" message when the `sundaySchool` feature is off or registration is closed (setting below).
2. Fills: parent name, email, mobile, optional address; 1-6 children (first name, last name, date of birth,
   optional school grade, allergies/medical notes, photo consent per child); optional emergency contact; consent tick.
3. Submits. Always sees the same neutral thanks text, including for honeypot drops and duplicates, so the form
   is not an oracle for "is this person known".
4. Gets a confirmation email (if mail is configured). No account, no status page, no token link in v1.

**Staff reviewer**
1. Sidebar badge on Sunday School shows pending count; list at `/sunday-school/registrations` (PENDING first).
2. Opens a request: decrypted detail, match candidates (see Matching), class suggestion by child age/grade.
3. Chooses family: merge into suggested family, or create new. Picks a class per child (optional, can be "later").
4. Approve or Reject (optional note). Result emailed to parent.

## Data model

New enum `SsRegistrationStatus { PENDING APPROVED REJECTED }`. New models (migration required, additive only):

```
SundaySchoolRegistration            // one parent submission
  id, status (default PENDING), createdAt
  email         String   // encrypted
  emailHash     String?  // HMAC blind index (hmacEmail): family match + per-email quota
  mobile        String?  // encrypted
  mobileHash    String?  // HMAC blind index (hmacMobile)
  payload       Json     // encrypted JSON string: parent name, address, emergency contact, consent text version
  consentAt     DateTime // plain: when the consent box was ticked
  linkedFamilyId Int?    // FK Family, onDelete SetNull (as MembershipApplication)
  reviewedById  Int?     // FK User
  reviewedAt, reviewNote String?
  anonymizedAt  DateTime?
  children      SundaySchoolRegistrationChild[]
  @@index([status]) @@index([emailHash]) @@index([mobileHash])

SundaySchoolRegistrationChild
  id, registrationId (FK Cascade), position Int
  firstName, lastName String   // encrypted
  dateOfBirth String           // encrypted String (same as Person.dateOfBirth)
  grade String?                // plain label, non-identifying ("Year 3")
  medicalNotes String?         // encrypted
  photoConsent Boolean
  requestedClassId Int?        // parent preference, FK SundaySchoolClass SetNull
  approvedClassId  Int?        // reviewer choice
  personId Int?                // set on approval, FK Person SetNull
  @@index([registrationId])
```

Why a child table: a parent may enrol several children, and approval links each to its created `Person`
(`personId`), which makes re-approval idempotent. The alternative (children inside the encrypted `payload`, as
`MembershipApplication` does) avoids a table but cannot be queried or linked.

Encrypt with `encrypt()` after Zod validation; read with `safeDecrypt` right after fetch (encryption.md).
Blind indexes only for email and mobile (the only equality lookups needed). No blind index on child names:
name matching decrypts the candidate family's people, a bounded set. Parent name lives inside the encrypted
payload (the membership form keeps `applicantName` in plaintext; not copied here, see decision 4).

Settings (no migration, `AppSetting` keys): `ssRegistration.open` (bool, default off), `ssRegistration.notifyEmail`.
Add the new encrypted fields to the encryption.md list and to `scripts/rotate-encryption-key.ts` FIELDS.

## Matching and dedup

Reuse the `findMembershipMatches` approach, new `findSsRegistrationMatches(id)`:
1. `Person.emailHash = emailHash` -> that person's family (reason "email").
2. `Person.mobileHash = mobileHash` -> family (reason "mobile").
3. Fallback: parent surname vs `Family.name` (reason "surname"), lowest confidence.
4. Per child in a matched family: compare decrypted first name + DOB with the family's people; flag
   "already in family" and default to "link existing Person" instead of create.

Submission time: no dedup that reveals state to the parent. Same-email repeats are capped by the per-email quota;
reviewers see other `PENDING` rows with the same `emailHash` and can reject the dupe.
Approval time: `SundaySchoolEnrolment @@unique([personId, year])` blocks double enrolment; map P2002 to a clear
error (pattern in `enrolChildren`).

## Approval flow

`approveSsRegistration(id, { mode: "create" } | { mode: "merge", familyId }, childPlans)`, modelled on
`approveMembershipApplication` (status checked as PENDING inside the transaction, one retry on P2002 for a racing
family name).

One transaction:
1. Family: create, or merge into the chosen family. Add the parent as `Person` only if no `emailHash`/`mobileHash`
   match already exists in that family.
2. Each child: create `Person` (child role, family set, encrypted DOB, medical notes into encrypted `Person.notes`)
   or link the chosen existing Person; set `child.personId`.
3. If `approvedClassId` set: `SundaySchoolEnrolment` with the same checks as `enrolChildren` (class live and not
   archived, year not locked via `isYearLockedTx`, one class per child per year).
4. Registration -> `APPROVED`, `reviewedById/At`, `linkedFamilyId`. Audit `SS_REGISTRATION_APPROVED`, ids only.

Children without a class stay as people and appear in the unenrolled picker. Reject: guarded `updateMany` on
`status = PENDING` (as `rejectMembershipApplication`), audit `SS_REGISTRATION_REJECTED`. Both actions:
`assertNotDemo`, `featureGuard("sundaySchool")`, role check at page AND action, `revalidatePath`.

## Abuse protection

Same stack as `submitMembershipApplication` and `submitPublicPrayerRequest`, in order:
1. Honeypot `hp_field`: silent drop with the normal thanks text.
2. `resolveClientIp(headers())`; no trusted IP -> fail closed, warn log (prayer-form behaviour).
3. Time-to-submit >= 3 s (`openedAt`), speed bump only.
4. In-memory `rateLimit("ssreg:pre:<ip>", 30, 60s)` before any DB work.
5. Feature/open check with generic public wording, then Zod validation (child cap 6, length caps, `isValidEmail`,
   DOB in the past, age 0-18).
6. Optional Turnstile: `verifyTurnstile` exists and is a no-op without keys. Wire as in membership; not required.
7. `dbRateLimit("ssreg:ip:<ip>", 5, 1h)` and `dbRateLimit("ssreg:email:<email>", 3, 1h)`, spent only after
   validation passes.
8. `bodyLimit.ts` size cap; no file uploads in v1.

Logs and audit carry ids and flags only: no IP, names or text.

## Permissions

| Action | Roles |
|---|---|
| Submit | anyone |
| View list/detail (decrypted PII, medical notes) | reviewers: ADMIN, PASTOR, OFFICE_ADMIN (`canEdit`), plus HEADMASTER per decision 3 |
| Approve / reject | same reviewers |
| TEACHER, VIEWER, AUDITOR, EVENT_ORGANISER | no access |

Add `canReviewSsRegistrations` in `roleGuard.ts`; reuse in page, action and nav gate (`navGates.ts`).

## Notifications

Existing `email.ts` + `emailTemplates.ts` (admin-editable):
- Parent: "Request received" on submit (generic subject, no child names).
- Staff: to `ssRegistration.notifyEmail` (fallback ADMIN/OFFICE_ADMIN users): "New Sunday School request", link
  only, no PII. Fire-and-forget, never fails the submit (membership pattern).
- Parent: approved (class name if set) and rejected (fixed text set, reviewer free text never echoed).
No SMS. A mistyped or hostile address can receive one email per accepted submission; the per-email quota bounds it.

## Privacy

- Consent text: "I am the parent or legal guardian. I agree the church may store this information to run Sunday
  School and contact me about it." Links to `/privacy`. Store `consentAt` and the text version. Per-child photo
  consent tick, default off.
- Minimum data: no school name, Medicare or custody details in v1.
- Retention (recommended): rejected anonymised 3 months after decision; approved 24 months (as
  `MEMBERSHIP_RETENTION_MONTHS`, live data is in Person/Family). PENDING never auto-purged; older than 12 months is
  flagged. Implement `ssRegistrationRetention.ts` + `scripts/purge-ss-registration-pii.ts` mirroring
  `membershipRetention.ts` (null encrypted fields, set `anonymizedAt`, keep status/dates). Needs a scheduler entry
  or documented manual cron.
- Erasure: reviewer can hard-delete a REJECTED or anonymised request (audited).

## Out of scope (v1)

Payments or fees; parent login or status page; editing a submitted request; document/photo uploads; waitlists and
capacity; next-year re-enrolment of existing children; SMS; auto-approval; mandatory CAPTCHA; multi-language;
importing the paper form.

## Test plan

Jest, mocks per `.claude/rules/testing.md` (crypto mock incl. `hmacEmail`/`hmacMobile`).
- `submitSsRegistration`: honeypot drop writes nothing and returns thanks; no trusted IP fails closed; too-fast
  refused; pre-throttle trips before DB; validation (0 or 7 children, future DOB, bad email); per-IP and per-email
  quota; success stores encrypted fields + hashes, never plaintext (assert `create` args); feature off/closed
  returns generic text.
- `findSsRegistrationMatches`: email, mobile, surname precedence; child already in family flagged.
- `approveSsRegistration`: create vs merge; only PENDING approvable; retry creates no duplicate Person; no class ->
  no enrolment; locked year and archived class rejected; P2002 mapped; role matrix over every `UserRole`; demo
  blocked; audit holds ids only.
- `rejectSsRegistration`: second call returns "already reviewed".
- Retention: cutoff math, only decided rows, PENDING untouched, idempotent via `anonymizedAt`.
- Component: form renders, hidden honeypot, add/remove child, consent required, 375px layout.
- Migration: `prisma migrate deploy` on a clean DB; rotation script covers the new fields.
- Manual: submit publicly, approve with a seeded demo family, confirm Person + enrolment on `/sunday-school`.

## Migration and rollout flags

- Migration REQUIRED: new enum, two tables, FKs, indexes. Additive, no backfill, no change to existing tables.
  A release adding a migration needs a human-reviewed `PROD_VERSION` bump for St Mark prod.
- No new env vars (Turnstile keys already optional). New `AppSetting` keys only.
- Same PR: website docs page for Sunday School + any stale README claim.
- Risky bucket (PII, public endpoint, migration): `/code-review high` once on the head.

## Open decisions for PO

1. **When do children become `Person` records?** (a) Only on approval, staged in request tables. (b) Immediately,
   flagged pending. Recommend (a): public input must never write into the live directory, so spam cannot pollute
   search and dedup.
2. **How does a parent identify an existing family?** (a) Reviewer matches by email/mobile blind index only.
   (b) Parent enters member number. (c) Both. Recommend (a): a member number on a public form lets anyone probe
   numbers; matching stays staff-side.
3. **Who reviews?** (a) ADMIN, PASTOR, OFFICE_ADMIN. (b) Also HEADMASTER. (c) Also TEACHERs for their class.
   Recommend (b): the headmaster already manages enrolment; teachers stay out because requests hold parent contact
   and medical notes.
4. **List display.** (a) Fully encrypted incl. names; list shows "N children" and date. (b) Plaintext parent name
   like `MembershipApplication.applicantName`. Recommend (a): children's data is the sensitive case and one decrypt
   per row on a bounded page is cheap.
5. **Retention of rejected requests.** (a) 3 months. (b) 24 months. (c) Delete on reject. Recommend (a): short
   enough to limit risk, long enough to answer a parent who asks why they were declined.

## PO decisions (2026-11-15)

All five open decisions approved as recommended: (1) Person/enrolment created only on staff approval; (2) reviewer matches existing family via email/mobile blind index, no member number on the public form; (3) reviewers ADMIN, PASTOR, OFFICE_ADMIN, HEADMASTER (not teachers); (4) list shows child count + date only, details encrypted; (5) retention: rejected 3 months, approved 24 months.
