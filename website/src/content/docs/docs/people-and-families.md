---
title: "People & Families"
description: "ParishCRM organises every member around two linked records: a Family (a household — address, contact details, status) and one or more People belonging to it…"
---

ParishCRM organises every member around two linked records: a **Family** (a household — address, contact details, status) and one or more **People** belonging to it (individual members with their own role in the family, contact details, and classification). This is the core membership register the rest of the app builds on — giving history, event registrations, and pastoral care all hang off a `Person` or `Family` record.

## Using it

**Nav:** *Families* and *People* in the main sidebar (both under the authenticated dashboard).

### Families list (`/families`)
- Search by family name, filter by status (Active / Inactive / Visitor) and suburb.
- Each row shows name, member number, suburb, status, and active member count.
- **New family** button opens the create form (name, member number, address, phone, status, joined date, marriage date, monthly dues, notes).
- **Import CSV** (ADMIN) links to the bulk family/member importer — see [Family CSV Import](/parishcrm/docs/family-csv-import/).
- **Print Directory** (ADMIN) opens a print-friendly family directory in a new tab.
- **View archived** and **Merge duplicates** links (ADMIN only) — see below.

### Family detail (`/families/[id]`)
Shows the family's contact details, member list, and (for roles that can view accounting) a giving summary link. Action buttons vary by role:
- **Edit** / **Archive** — ADMIN, PASTOR, OFFICE_ADMIN (`canEdit`).
- **Delete** — ADMIN only, and only once the family has no linked transactions and no active members (see below).
- **Send self-update invite** — emails a secure link the family can use to review/update their own details; see [Family Self-Update](/parishcrm/docs/family-self-update/).
- **Welcome letter** — build and email a new-member welcome letter (PDF) to selected family members (`src/lib/actions/welcomeLetter.ts`).
- A "last updated" line shows who last changed the family or any of its members, and whether the change came from an admin edit or an approved self-update submission (`src/lib/actions/familyActivity.ts`).

### Adding/editing a person
From a family's page, **Add person** opens `/families/[id]/people/new`. The person form captures name (first/middle/last, title, suffix), gender, date of birth, family role (Head / Spouse / Child / Other), classification (Member / Visitor / Inactive / Student), contact details (email, mobile, work/home phone), membership date, baptism date, notes, profession, mother parish, marital status, banking name (for bank-import auto-matching), and email consent. It also has a **Ministry roles** checkbox group (Staff, Volunteer, Sunday school teacher, Youth leader, Children's ministry, Other) for the roles the person serves in. **Pastoral notes** and **emergency contact** fields only appear for roles allowed to see them (see below).

### People list (`/people`)
- Search by first/last name; filter by classification, family role and ministry role.
- The **Export CSV** link carries the same filters, including ministry role, and the CSV has a **Ministry Roles** column (labels joined with "; ").
- Capped at 500 rows per query — narrow with filters if a search is truncated (a banner explains this).
- **Export CSV** (ADMIN only) downloads the filtered list.
- **New person** requires picking (or having) a family first, in practice usually reached via a family page.

### Ministry roles
Each person can be tagged with any number of ministry roles: **Staff**, **Volunteer**, **Sunday school teacher**, **Youth leader**, **Children's ministry** or **Other**. Tick them on the person form (ADMIN, PASTOR, OFFICE_ADMIN). They appear as badges in the **Church** card on the person's profile, visible to every role that can open the profile, and you can filter `/people` by them (`?ministryRole=VOLUNTEER`). The tag marks who works with children or serves the church; it is the basis for tracking child-safety clearances (Working With Children Check, Safe Ministry), described below.

### Roles who can see or do what

| Role | Families/People |
|------|------------------|
| `ADMIN` | Full CRUD, archive/unarchive, delete, merge, CSV import/export, pastoral notes, welcome letters |
| `PASTOR` | Full CRUD + pastoral notes; cannot delete a family/person or merge/import |
| `OFFICE_ADMIN` | Create/edit families & people, cannot see pastoral notes or emergency-contact fields, cannot delete/merge/import |
| `AUDITOR` | No access — people/family pages redirect away (accounting-only role) |
| `VIEWER` | Read-only list/detail views and the clearance status badge only (never the number or document), no pastoral notes, no edit actions |
| `EVENT_ORGANISER` | No access to People/Families at all — confined to their own managed events, plus children's names and attendance marks on the Sunday School rolls they're assigned to |

### Safeguarding clearances (WWCC and Safe Ministry)

Each person's page has a **Safeguarding** card with one row for the **Working With Children Check (WWCC)** and one for the **Safe Ministry** certificate. Staff (ADMIN, PASTOR, OFFICE_ADMIN) can:

- **Add / Update** — record the number and expiry date (both optional; a clearance with no expiry never expires) and upload the document (JPEG, PNG or PDF, up to 4 MB). A new upload replaces the previous one; the audit log keeps the history.
- **Verify** — after checking the clearance (for a WWCC, on the issuing portal — the dialog has a **Check on OCG portal ↗** link, default the NSW Office of the Children's Guardian employer portal), click **Verify** and add an optional note (up to 500 characters). The card then shows who verified it and when. **Editing the number, expiry or document clears the verification**, so it must be checked again.
- **View document**, **Unverify** and **Remove** (removing deletes the record and its document permanently).

Status badges: **Missing**, **Unverified**, **Verified**, **Expiring (60 days)** (verified, but expires within 60 days; a clearance is still valid on its expiry date — an unverified one shows **Unverified** instead) and **Expired**. People tagged with a ministry role (see ministry roles above) are the ones who need a clearance; staff can add one for anyone. VIEWER accounts see only the status badges, and only on people who have a ministry role or a clearance record.

The portal link is the app setting `clearance.wwccVerifyUrl` (an `https://` URL). Outside NSW, add or edit that row in the `AppSetting` table to point at your state's check; if unset or not a valid `https://` URL the NSW URL is used.

### Clearance compliance (`/people/clearances`)

*People → Clearances* in the sidebar (ADMIN, PASTOR and OFFICE_ADMIN only). It lists every active person who has a ministry role or a clearance on file, with a WWCC status and a Safe Ministry status for each: **Missing**, **Unverified**, **Verified**, **Expiring (60 days)** or **Expired**. Anyone with a ministry role is expected to hold both clearances, so an absent one shows as Missing. A person with no ministry role is not marked Missing for a clearance they do not have. The list shows up to 2,000 people after the filter is applied, and says so if there are more.

- **Filter chips** (Expired, Expiring, Missing, Unverified) narrow the list to people with that status on either clearance.
- **Export CSV** downloads the current filter: names, roles, statuses and dates only. It never contains WWC numbers or dates of birth. Each export is written to the audit log (`CLEARANCE_EXPORTED`).
- **Verify WWCC batch** (`?view=batch`) lists up to 2,000 WWCCs that have a record, have never been verified and have not expired. If more remain, verify the rows shown and reload for the rest. Each row shows the fields in the order the NSW Office of the Children's Guardian (OCG) employer portal asks for it: family name, date of birth (dd/mm/yyyy) and WWC number, each with a copy button, plus **Copy all rows**. A verified WWCC is not listed, even if it expires soon, because renewing it clears the verification. The portal has no public API, so you check the workers there, tick the rows it confirmed, add an optional note (up to 500 characters, such as the portal's outcome) and press **Mark verified**. That records who verified each clearance and when. Rows with no date of birth or number are flagged and cannot be ticked. You can mark up to 200 at a time. **Select all** ticks the first 200 ready rows.
- **Mark verified is all or nothing.** If any selected clearance was edited or verified by someone else since the page loaded, nothing is saved and you see "This clearance changed. Refresh and try again." Reload the page and tick the rows again.
- **Audit log.** Opening the list writes `CLEARANCE_LIST_VIEWED` (with the filter and row count). Opening the batch view writes `CLEARANCE_BATCH_VIEWED`. Each clearance you mark verified writes its own `CLEARANCE_VERIFIED` entry.
- **Monthly digest (opt-in, `CLEARANCE_DIGEST=true`).** Once a month, ADMIN and PASTOR users get one email naming the people with a ministry role who have expired, expiring, missing or unverified clearances, with a link to this page. It also reminds you to act on any barring-alert email the OCG sends to the employer when a registered worker is barred. Nothing is sent when every clearance is in order. See [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/).

## How it works

### Data model
`prisma/schema.prisma`:
- `Family`: `name` (unique), `memberNo` (unique, optional — blank for non-member families), `address`/`suburb`/`state`/`postcode`/`homePhone` (encrypted), `status` (`FamilyStatus`: ACTIVE/INACTIVE/VISITOR), `joinedDate`, `marriageDate`, `monthlyDues` (`Decimal(10,2)`), `notes` (encrypted), `archivedAt` (soft-delete). Related to many `Person` (cascade delete), `Transaction` (giving), `FamilyUpdateInvite`/`FamilyUpdateSubmission`, and `MembershipApplication`.
- `Person`: `familyId` FK, name fields, `role` (`FamilyRole`: HEAD/SPOUSE/CHILD/OTHER), `classification` (`Classification`: MEMBER/VISITOR/INACTIVE/STUDENT), `ministryRoles` (`MinistryRole[]`: STAFF/VOLUNTEER/SUNDAY_SCHOOL_TEACHER/YOUTH_LEADER/CHILDREN_MINISTRY/OTHER; a Postgres enum array, plaintext, default empty), `gender`, `dateOfBirth` (encrypted string, not a `DateTime`), `email`/`mobile`/`workPhone`/`homePhone` (encrypted), `emailHash`/`mobileHash` (deterministic HMAC blind indexes for equality lookups — see Encryption below), `notes`/`pastoralNotes`/`emergencyContactName`/`emergencyContactPhone` (encrypted), `emailConsent` (default true) + `consentUpdatedAt`, `bankingName` (plaintext, deliberately — a public alias members give banks for transfer matching), `archivedAt`.
- Unique constraints: `Family(name)`, `Family(memberNo)`, `Person(familyId, firstName, lastName)`. Indexes support the default `/people` sort (`lastName, firstName`), the `archivedAt + role` filter combo, and blind-index/mobile lookups.

### Server actions (`src/lib/actions/family.ts`, `src/lib/actions/person.ts`)
- `createFamily` / `updateFamily`: Zod-validated, `canEdit`-gated. Dates are validated explicitly (a malformed string would otherwise become an `Invalid Date` that crashes Postgres with an unhandled error). `monthlyDues` is kept as a validated decimal string all the way to the DB — never converted through a floating-point number. `updateFamily` uses **optimistic concurrency**: the form submits the row's last-seen `updatedAt`; a mismatch (someone else saved first) fails the update and asks the user to reload.
- `createPerson` / `updatePerson`: same pattern, plus a role check that strips `pastoralNotes`/`emergencyContactName`/`emergencyContactPhone` from the payload server-side before it's ever written, for any role that can't see them — client-side hiding of the fields is not treated as sufficient. Ministry roles are read from the repeated `ministryRoles` form field and validated against the enum; any unknown value rejects the whole save.
- `deletePerson` (ADMIN only): blocked if the person has linked giving/receipt records (Transaction, DGR receipt, petty cash receipt) — those are `SetNull` on delete, so removing the person would silently orphan financial history. The check-then-delete runs in a single Serializable transaction so a concurrent giving entry can't slip through the gap between the count and the delete.
- `deleteFamily` (ADMIN only): blocked while any transactions or active members are linked; only becomes possible on a family archived **past a 7-year retention floor** (`src/lib/retention.ts`), matching Australian tax record-keeping rules. Below that floor, archiving is the only option.
- `archiveFamily` / `unarchiveFamily` (ADMIN): soft-archive is atomic across the family and all its members (`$transaction`) — a family and its people are never left half-archived. Archived families live only at `/families/archived`.
- `previewMerge` / `mergeFamilies` (ADMIN): merges a duplicate family into a target — moves all people, transactions, and membership-application links, re-parents self-update invite/submission history, and reports name-collision conflicts before committing. Blocked while either family is archived, or while the source has a pending self-update submission awaiting review.

### Pastoral notes gating
`canSeePastoralNotes` (`src/lib/roleGuard.ts`) governs both rendering (the UI never shows the field to a role that can't see it) and the action layer (the field is `delete`d from the payload server-side). ADMIN and PASTOR can see and edit pastoral notes and emergency-contact details; OFFICE_ADMIN, AUDITOR, VIEWER, and EVENT_ORGANISER cannot.

### Encryption
Encrypted-at-rest fields (AES-256-GCM, `src/lib/crypto.ts`): on `Family` — address, suburb, state, postcode, homePhone, notes; on `Person` — email, dateOfBirth, mobile, workPhone, homePhone, notes, pastoralNotes, emergencyContactName, emergencyContactPhone. `Person.email` and `Person.mobile` also get a deterministic HMAC **blind index** (`emailHash`/`mobileHash`) computed from the plaintext before encryption, so equality lookups (matching a member to their event registrations, or a membership application to an existing family) can use an indexed query instead of decrypting every row. `bankingName` is deliberately left plaintext — it's a name a member already shares publicly with the bank for transfer matching.

### Audit logging
Every mutation is audited (`src/lib/audit.ts`): `FAMILY_CREATED/UPDATED/ARCHIVED/UNARCHIVED/MERGED`, `PERSON_CREATED/UPDATED/DELETED`. Person audit metadata deliberately excludes member PII — only the linked `familyId`. `PERSON_UPDATED` also records the person's ministry roles (not PII). `FAMILY_MERGED` records the source family id/name on the target's audit entry. Bulk CSV import is audited as `IMPORT_CSV`; bulk people CSV export as `EXPORT_CSV`.

### Edge cases worth knowing
- A same-name person within a family (`familyId, firstName, lastName` collision) returns a clean validation error rather than a raw database error.
- Renaming a family to collide with another name, or reusing a member number, returns a specific error distinguishing the two unique constraints.
- Editing an archived family or person directly (bypassing the UI, e.g. a stale tab) is rejected — archived records return "Not found" rather than silently succeeding.
- List views cap results (500 for people and families, a higher in-memory scan cap when filtering by the encrypted `suburb` field, since that filter can't be pushed to the database) and show a banner when a search is truncated.

## Configuration

No environment variables directly control this feature. Field encryption requires the standard `ENCRYPTION_KEY*` keyring (see the encryption rules doc in the source repo) to be configured for the app to boot at all.
