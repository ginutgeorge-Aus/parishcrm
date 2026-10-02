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
From a family's page, **Add person** opens `/families/[id]/people/new`. The person form captures name (first/middle/last, title, suffix), gender, date of birth, family role (Head / Spouse / Child / Other), classification (Member / Visitor / Inactive / Student), contact details (email, mobile, work/home phone), membership date, baptism date, notes, profession, mother parish, marital status, banking name (for bank-import auto-matching), and email consent. **Pastoral notes** and **emergency contact** fields only appear for roles allowed to see them (see below).

### People list (`/people`)
- Search by first/last name; filter by classification and family role.
- Capped at 500 rows per query — narrow with filters if a search is truncated (a banner explains this).
- **Export CSV** (ADMIN only) downloads the filtered list.
- **New person** requires picking (or having) a family first, in practice usually reached via a family page.

### Roles who can see or do what

| Role | Families/People |
|------|------------------|
| `ADMIN` | Full CRUD, archive/unarchive, delete, merge, CSV import/export, pastoral notes, welcome letters |
| `PASTOR` | Full CRUD + pastoral notes; cannot delete a family/person or merge/import |
| `OFFICE_ADMIN` | Create/edit families & people, cannot see pastoral notes or emergency-contact fields, cannot delete/merge/import |
| `AUDITOR` | No access — people/family pages redirect away (accounting-only role) |
| `VIEWER` | Read-only list/detail views, no pastoral notes, no edit actions |
| `EVENT_ORGANISER` | No access to People/Families at all — confined to their own managed events |

## How it works

### Data model
`prisma/schema.prisma`:
- `Family`: `name` (unique), `memberNo` (unique, optional — blank for non-member families), `address`/`suburb`/`state`/`postcode`/`homePhone` (encrypted), `status` (`FamilyStatus`: ACTIVE/INACTIVE/VISITOR), `joinedDate`, `marriageDate`, `monthlyDues` (`Decimal(10,2)`), `notes` (encrypted), `archivedAt` (soft-delete). Related to many `Person` (cascade delete), `Transaction` (giving), `FamilyUpdateInvite`/`FamilyUpdateSubmission`, and `MembershipApplication`.
- `Person`: `familyId` FK, name fields, `role` (`FamilyRole`: HEAD/SPOUSE/CHILD/OTHER), `classification` (`Classification`: MEMBER/VISITOR/INACTIVE/STUDENT), `gender`, `dateOfBirth` (encrypted string, not a `DateTime`), `email`/`mobile`/`workPhone`/`homePhone` (encrypted), `emailHash`/`mobileHash` (deterministic HMAC blind indexes for equality lookups — see Encryption below), `notes`/`pastoralNotes`/`emergencyContactName`/`emergencyContactPhone` (encrypted), `emailConsent` (default true) + `consentUpdatedAt`, `bankingName` (plaintext, deliberately — a public alias members give banks for transfer matching), `archivedAt`.
- Unique constraints: `Family(name)`, `Family(memberNo)`, `Person(familyId, firstName, lastName)`. Indexes support the default `/people` sort (`lastName, firstName`), the `archivedAt + role` filter combo, and blind-index/mobile lookups.

### Server actions (`src/lib/actions/family.ts`, `src/lib/actions/person.ts`)
- `createFamily` / `updateFamily`: Zod-validated, `canEdit`-gated. Dates are validated explicitly (a malformed string would otherwise become an `Invalid Date` that crashes Postgres with an unhandled error). `monthlyDues` is kept as a validated decimal string all the way to the DB — never converted through a floating-point number. `updateFamily` uses **optimistic concurrency**: the form submits the row's last-seen `updatedAt`; a mismatch (someone else saved first) fails the update and asks the user to reload.
- `createPerson` / `updatePerson`: same pattern, plus a role check that strips `pastoralNotes`/`emergencyContactName`/`emergencyContactPhone` from the payload server-side before it's ever written, for any role that can't see them — client-side hiding of the fields is not treated as sufficient.
- `deletePerson` (ADMIN only): blocked if the person has linked giving/receipt records (Transaction, DGR receipt, petty cash receipt) — those are `SetNull` on delete, so removing the person would silently orphan financial history. The check-then-delete runs in a single Serializable transaction so a concurrent giving entry can't slip through the gap between the count and the delete.
- `deleteFamily` (ADMIN only): blocked while any transactions or active members are linked; only becomes possible on a family archived **past a 7-year retention floor** (`src/lib/retention.ts`), matching Australian tax record-keeping rules. Below that floor, archiving is the only option.
- `archiveFamily` / `unarchiveFamily` (ADMIN): soft-archive is atomic across the family and all its members (`$transaction`) — a family and its people are never left half-archived. Archived families live only at `/families/archived`.
- `previewMerge` / `mergeFamilies` (ADMIN): merges a duplicate family into a target — moves all people, transactions, and membership-application links, re-parents self-update invite/submission history, and reports name-collision conflicts before committing. Blocked while either family is archived, or while the source has a pending self-update submission awaiting review.

### Pastoral notes gating
`canSeePastoralNotes` (`src/lib/roleGuard.ts`) governs both rendering (the UI never shows the field to a role that can't see it) and the action layer (the field is `delete`d from the payload server-side). ADMIN and PASTOR can see and edit pastoral notes and emergency-contact details; OFFICE_ADMIN, AUDITOR, VIEWER, and EVENT_ORGANISER cannot.

### Encryption
Encrypted-at-rest fields (AES-256-GCM, `src/lib/crypto.ts`): on `Family` — address, suburb, state, postcode, homePhone, notes; on `Person` — email, dateOfBirth, mobile, workPhone, homePhone, notes, pastoralNotes, emergencyContactName, emergencyContactPhone. `Person.email` and `Person.mobile` also get a deterministic HMAC **blind index** (`emailHash`/`mobileHash`) computed from the plaintext before encryption, so equality lookups (matching a member to their event registrations, or a membership application to an existing family) can use an indexed query instead of decrypting every row. `bankingName` is deliberately left plaintext — it's a name a member already shares publicly with the bank for transfer matching.

### Audit logging
Every mutation is audited (`src/lib/audit.ts`): `FAMILY_CREATED/UPDATED/ARCHIVED/UNARCHIVED/MERGED`, `PERSON_CREATED/UPDATED/DELETED`. Person audit metadata deliberately excludes member PII — only the linked `familyId`. `FAMILY_MERGED` records the source family id/name on the target's audit entry. Bulk CSV import is audited as `IMPORT_CSV`; bulk people CSV export as `EXPORT_CSV`.

### Edge cases worth knowing
- A same-name person within a family (`familyId, firstName, lastName` collision) returns a clean validation error rather than a raw database error.
- Renaming a family to collide with another name, or reusing a member number, returns a specific error distinguishing the two unique constraints.
- Editing an archived family or person directly (bypassing the UI, e.g. a stale tab) is rejected — archived records return "Not found" rather than silently succeeding.
- List views cap results (500 for people and families, a higher in-memory scan cap when filtering by the encrypted `suburb` field, since that filter can't be pushed to the database) and show a banner when a search is truncated.

## Configuration

No environment variables directly control this feature. Field encryption requires the standard `ENCRYPTION_KEY*` keyring (see the encryption rules doc in the source repo) to be configured for the app to boot at all.
