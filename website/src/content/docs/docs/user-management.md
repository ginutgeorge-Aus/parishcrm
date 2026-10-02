---
title: "User Management"
description: "Staff accounts (as opposed to member/parishioner records) are managed under Users, by anyone with the canManageUsers permission — ADMIN or OFFICE_ADMIN. This…"
---

Staff accounts (as opposed to member/parishioner records) are managed under **Users**, by
anyone with the `canManageUsers` permission — `ADMIN` or `OFFICE_ADMIN`. This page covers
creating, editing, deactivating, and unlocking accounts, and the safeguards that stop a
parish from accidentally locking itself out of its own system. For what each role can do,
see [Roles-and-Permissions](/parishcrm/docs/roles-and-permissions/); for the login/verification flow a new user goes through, see
[Login-and-Two-Step-Verification](/parishcrm/docs/login-and-two-step-verification/).

## Using it

**Creating a new staff account:**
1. Go to **Users → New user**.
2. Enter name, email, and role.
3. Save. The account is created with an unusable random password — nobody can log into it
   as-is. The new user is immediately emailed a "set your password" invite link, valid for 7
   days.
4. If the OFFICE_ADMIN creating the account is not an ADMIN, the role field is restricted to
   non-ADMIN, non-PASTOR roles (see [Roles-and-Permissions](/parishcrm/docs/roles-and-permissions/) for why).

**Editing an account:** open the user from the Users list, change name/email/role, and
optionally set a new password directly (this immediately signs the user out everywhere and
clears any lockout on the account). An OFFICE_ADMIN cannot edit an ADMIN or PASTOR account,
and cannot change anyone's role to ADMIN or PASTOR.

**Resending the welcome invite:** if the original invite email never arrived or expired, use
**Resend invite** on the user's row — it issues a fresh 7-day token and re-sends the email.

**Unlocking an account:** if a staff member is locked out after repeated failed
password/code attempts, an admin/office-admin can click **Unlock** on their row — this clears
both the password lockout and the verification-code lockout. Locks also expire automatically
after 15 minutes, so unlocking is a convenience, not a requirement. You cannot unlock your
own account this way (use a different admin, or just wait 15 minutes).

**Resetting someone's authenticator app:** if a staff member loses the phone with their
authenticator app, click **Reset 2FA** on their row (shown only when they have one turned
on). This removes the authenticator, its backup codes and their trusted devices, and signs
them out; they sign in with emailed codes until they set it up again. Only an ADMIN can do
this for an ADMIN or PASTOR, and you can't reset your own (use **My Account**). See
[Login-and-Two-Step-Verification](/parishcrm/docs/login-and-two-step-verification/#using-it).

**Deactivating a user:** delete the account from the Users list. This is a soft delete — the
account stops being usable and its email is freed up for reuse, but the user's historical
record (audit log entries, who created/edited what) is preserved rather than erased.

**Note:** an admin/office-admin can never delete or unlock their own account from this
screen — those actions must be taken by someone else.

## How it works

User accounts live in `src/lib/actions/user.ts` (`createUser`, `updateUser`, `unlockUser`,
`resetUserTotp`, `deleteUser`, `resendWelcome`), all gated by `canManageUsers` and `canAssignRole` from
`src/lib/roleGuard.ts` — see [Roles-and-Permissions](/parishcrm/docs/roles-and-permissions/) for the escalation rules those
enforce.

**Password-less provisioning.** `createUser` never asks for a password. It writes a random,
unusable bcrypt hash and instead issues a single-use, HMAC-hashed, 7-day password-reset token
and emails a set-password link built from the `AUTH_URL` origin. `resendWelcome` re-issues
the same kind of token. If the email send fails, the token is rolled back so a dangling,
never-delivered credential doesn't sit in the database for the full week.

**Soft delete, not hard delete.** `deleteUser` never removes the row — every user who has
ever logged in owns audit-log entries that reference their account, and the database
foreign key prevents deleting a user with those references. Instead the account is archived:
`archivedAt` is stamped, the email is tombstoned (prefixed so the original address is free
for a new invite), all live sessions for that user are invalidated, and any outstanding
password-reset token is voided. An archived user can never authenticate again — this is
checked both at login and on every subsequent request (`jwtCallback` in `src/auth.ts` kills
the session the instant `archivedAt` is set).

**Last-admin protection.** Demoting an `ADMIN` to another role, or deleting an `ADMIN`
account, first counts how many *other* active (non-archived) admins exist. If the count is
zero, the action is blocked with "Cannot remove/delete the last administrator." This count-
and-write happens inside a single serializable database transaction, so two concurrent
demotions of two different admins can't both succeed and leave the parish with zero admins —
the database itself aborts one side as a serialization conflict, which the UI surfaces as
"please try again."

**Race-safety on role escalation.** Because authorization checks read the target user's
current role before the write happens, a window exists in principle for someone to be
promoted to ADMIN/PASTOR in between. Every mutating action re-reads (or conditions its write
on) the target's role at write time, so a promotion mid-flight makes the concurrent
non-ADMIN action's write simply match nothing, rather than silently succeeding against a now-
elevated account.

**Password requirements** (self-service reset, admin-set password, and account creation via
the invite link all share the same rule): minimum 8 characters, at least one uppercase, one
lowercase, one digit, and one special character.

**Setting a password clears lockouts.** Whenever an admin sets a new password for a user, or
a user resets their own password, all four lockout counters/timestamps (password and
verification-code) are cleared — a user who was locked out is not left stuck after a
password reset resolves the underlying issue.

## Configuration

| Variable | Purpose |
|---|---|
| `AUTH_URL` | Base URL used to build the invite/reset link sent to new and existing users. Outside local development, a missing or invalid `AUTH_URL` fails the invite/reset send outright rather than emailing a link that only resolves on the wrong machine. |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | SMTP credentials the welcome/invite/reset emails are sent through. |
| `ALLOW_DEMO_SEED` | Opt-in flag for the database seed script to create demo users with publicly-known passwords — never set outside local development. |

No environment variable changes who *can* manage users — that is entirely role-based; see
[Roles-and-Permissions](/parishcrm/docs/roles-and-permissions/).
