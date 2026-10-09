---
title: "Roles and Permissions"
description: "ParishCRM uses a single role field per user account, chosen from six fixed roles. Every permission check in the app — page access, server actions, API routes…"
---

ParishCRM uses a single role field per user account, chosen from six fixed roles. Every
permission check in the app — page access, server actions, API routes — reduces to a small
set of role-helper functions, so the effective permission model is centralized and
predictable rather than scattered checks. This page is the reference matrix; see
[Security-Model](/parishcrm/docs/security-model/) for how the middleware enforces the boundary and [User-Management](/parishcrm/docs/user-management/) for
how roles are assigned and changed.

## Using it

- An ADMIN or OFFICE_ADMIN sets a user's role when creating or editing their account under
  **Users** (`/users`). See [User-Management](/parishcrm/docs/user-management/) for the step-by-step.
- A user's own role determines which sidebar sections and pages they see. There is no way
  for a user to change their own role.
- If a page or button seems to be missing for a staff member, check their role against the
  matrix below before assuming it's a bug.

## How it works

All six roles are defined once, in the Prisma `UserRole` enum, and read everywhere through a
small set of helper functions in `src/lib/roleGuard.ts`. Nothing checks `role === "ADMIN"`
inline outside that file — every gate (page, layout, server action, API route) calls one of
these helpers, so the permission boundary lives in one place.

### The six roles

| Role | Summary |
|------|---------|
| `ADMIN` | Full access. The only role that can manage other ADMIN or PASTOR accounts, and the only role that can assign either of those roles to someone else. |
| `PASTOR` | Full content access plus pastoral notes and accounting entry, but cannot manage users. |
| `OFFICE_ADMIN` | Day-to-day office operations: people/family/event editing, read-only accounting, and user management — except it cannot touch ADMIN or PASTOR accounts or grant either role (self-escalation guard). |
| `AUDITOR` | Accounting-only, read-only. Deliberately excluded from people/family records so it never sees decrypted member PII. |
| `VIEWER` | Read-only people/families/events. No pastoral notes, no accounting. |
| `EVENT_ORGANISER` | No dashboard access at all. Confined by middleware to their own assigned event's management pages. |

### Role-assignment limits (privilege escalation guard)

Because `OFFICE_ADMIN` can manage users, a naive implementation would let an `OFFICE_ADMIN`
grant themselves `ADMIN` or `PASTOR`, or take over a `PASTOR` account by resetting its
password. `canAssignRole(actorRole, targetRole)` in `src/lib/roleGuard.ts` closes this:

- `ADMIN` actors can assign any role to any account.
- Any other actor (in practice `OFFICE_ADMIN`, the only other role with user-management
  access) can only assign roles other than `ADMIN` or `PASTOR`, and can only act on target
  accounts that do not already hold one of those two roles.

This is enforced server-side in `src/lib/actions/user.ts` on every mutating path — create,
update, delete, unlock, and resend-invite — not just in the UI. A non-ADMIN request that
tries to create, edit, unlock, or delete an ADMIN/PASTOR account, or promote anyone to
ADMIN/PASTOR, is rejected with "Unauthorized" regardless of what the client sends. Some
mutations also carry the same guard into their Prisma `where` clause, so a target that gets
promoted to ADMIN/PASTOR in the moment between the authorization check and the write simply
fails to match any row, rather than being acted on anyway.

### Last-admin protection

The system will not let the last `ADMIN` account be demoted or deleted — including by that
admin acting on their own account being impossible in the first place (self-delete and
self-unlock are separately blocked). The count of other active ADMIN accounts is re-checked
inside the same database transaction that performs the demotion or deletion, under
serializable isolation, so two concurrent admin actions can't race their way to zero admins.
See [User-Management](/parishcrm/docs/user-management/) for details.

### Full feature × role matrix

| Feature / capability | ADMIN | PASTOR | OFFICE_ADMIN | AUDITOR | VIEWER | EVENT_ORGANISER |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Dashboard / sidebar access | Yes | Yes | Yes | Yes | Yes | No — confined to `/my-events` |
| View people & families | Yes | Yes | Yes | No | Yes | No |
| Edit people & families / events | Yes | Yes | Yes | No | No | Own assigned events only |
| Pastoral notes (view) | Yes | Yes | No | No | No | No |
| Safeguarding clearances — upload, verify, view document and number | Yes | Yes | Yes | No | No | No |
| Clearance compliance page, WWCC batch verify, CSV export, digest email (`/people/clearances`) | Yes | Yes | Yes | No | No | No |
| Safeguarding clearances — status badge only | Yes | Yes | Yes | No | Yes | No |
| Accounting — view (transactions, reports, petty cash, receipt audit) | Yes | Yes | Yes | Yes | No | No |
| Accounting — mutate (create/edit transactions, reconcile, close petty cash) | Yes | Yes | No | No | No | No |
| CSV export (accounting) | Yes | Yes | Yes | Yes | No | No |
| User management (create/edit/deactivate/unlock) | Yes | No | Yes (not ADMIN/PASTOR targets) | No | No | No |
| Assign ADMIN or PASTOR role | Yes | No | No | No | No | No |
| Own event: view registrations, check attendees in | Yes | Yes | Yes | No | No | Yes (own events) |
| Full CRUD everywhere / accounting admin | Yes | No | No | No | No | No |

Role helpers and where each lives, for reference:

| Helper (`src/lib/roleGuard.ts`) | Grants |
|---|---|
| `canEdit` | ADMIN \| PASTOR \| OFFICE_ADMIN — content edits (people/families/events), not accounting |
| `canAccessAccounting` | ADMIN \| PASTOR — accounting mutations |
| `canViewAccounting` | ADMIN \| PASTOR \| AUDITOR \| OFFICE_ADMIN — accounting read paths |
| `canViewPeople` | ADMIN \| PASTOR \| OFFICE_ADMIN \| VIEWER (not AUDITOR) |
| `canManageClearances` | ADMIN \| PASTOR \| OFFICE_ADMIN (same as `canEdit`) — upload, verify, view/download the document and number |
| `canViewClearanceStatus` | `canManageClearances` plus VIEWER (badge only) |
| `canSeePastoralNotes` | ADMIN \| PASTOR |
| `canManageUsers` | ADMIN \| OFFICE_ADMIN (target/role limits per `canAssignRole`) |
| `canAssignRole(actor, target)` | Whether `actor` may assign/act on `target` role |
| `isAdmin` | ADMIN only |
| `isEventOrganiser` | EVENT_ORGANISER only |

### EVENT_ORGANISER confinement

Unlike the other five roles, `EVENT_ORGANISER` is enforced primarily in `src/middleware.ts`
rather than by a role-helper gate on each page: any authenticated request from an
`EVENT_ORGANISER` whose path isn't on the organiser allow-list (their own `/my-events`
pages, plus a small set of shared public/auth/asset paths) is redirected straight back to
`/my-events`. A hand-typed URL to `/people` or `/accounting` never renders for this role.

## Configuration

Roles are a fixed enum in the Prisma schema (`prisma/schema.prisma`, `UserRole`) — there is
no environment variable to add, remove, or rename a role. No `.env` configuration affects
role behaviour; everything here is data (the `role` column on `User`) and code
(`src/lib/roleGuard.ts`). See [User-Management](/parishcrm/docs/user-management/) for how a role is set on a given account.
