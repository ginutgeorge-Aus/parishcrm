---
title: "Family CSV Import"
description: "A bulk importer for loading families and their members from a spreadsheet — useful for migrating from another system or a paper register. It creates new…"
---

A bulk importer for loading families and their members from a spreadsheet — useful for migrating from another system or a paper register. It creates new families and people; it never overwrites an existing person's details, so it's safe to re-run the same file (for example after fixing a few rows).

## Using it

**Nav:** *Families → Import CSV* (or `/import` directly). **ADMIN only.**

1. Prepare a CSV with one row per person, grouped by family. Required column: `family_name`. Optional family-level columns (only need to be filled on a group's first row — they're inherited across the group): `member_no`, `address`, `suburb`, `state`, `postcode`. Per-person columns: `first_name`, `last_name`, `dob`, `gender`, `role`, `classification`, `email`, `mobile`. The import screen shows a sample file you can use as a template.
2. Choose the file and click **Check** — this parses and validates the file without writing anything, showing a preview of what would be created plus any row-level errors.
3. Review the preview, then **Confirm** to run the actual import.
4. The result screen reports how many people were imported, how many were skipped (already existed), and lists any row errors.

Only ADMIN can reach this page — everyone else is redirected to `/families`.

## How it works

### Parsing (`src/lib/csv.ts`)
`parseCsv(content)` is a pure function (no DB access) returning `{ rows, errors }`. Family fields are inherited from the first row of each family-name group. Date of birth is parsed explicitly as `DD/MM/YYYY` or ISO `YYYY-MM-DD` using `Date.UTC` with a reconstruct-mismatch check that rejects invalid calendar dates (e.g. 31/02) — it deliberately avoids the bare `new Date(str)` constructor, which is locale-ambiguous and would silently misparse `01/02/1990` as US month/day ordering. A malformed `dob` produces a row error and the date is simply omitted, rather than persisting an invalid date.

### Import (`src/app/api/import/families/route.ts`, POST, ADMIN-gated)
- Rejects oversized uploads before reading the full body (6 MB request-size check, then a 5 MB file-size check) and caps at 5,000 rows — a large file otherwise risked doing per-row sequential DB writes and timing out the request.
- Rate-limited to 10 imports/minute per admin user.
- Families are **upserted by name**, scoped to non-archived families only — so a CSV re-import can create a fresh family under a name that's already used by an archived one, rather than silently reviving it. `update: {}` on the upsert means re-importing a file never overwrites an existing family's fields (notably `memberNo` is never clobbered by a re-run).
- People are matched on `(familyId, firstName, lastName)`; an existing match is **skipped**, not updated — the importer only ever adds new records, it's not a general sync tool.
- Family/person PII (address, suburb, state, postcode, date of birth) is encrypted before being written, exactly as it would be through the normal create forms.
- Errors are collected per-row with a friendly message (e.g. "duplicate record", "member number already in use") — the underlying Prisma error text is logged server-side but never echoed to the client, since it can leak field values. The audit log records only the affected row-number range, never a member's name.
- A successful import is audited as `IMPORT_CSV`.

### Preview endpoint
A companion `check` endpoint (called by the **Check** button) runs the same parse/validation path without writing to the database, so admins can catch formatting problems before committing.

## Configuration

No environment variables. Row cap (5,000) and file-size cap (5 MB) are constants in the route handler, not configurable via settings.
