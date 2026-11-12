import { UserRole } from "@/lib/generated/prisma/enums"

export function canEdit(role: UserRole | undefined): boolean {
  return role === UserRole.ADMIN || role === UserRole.PASTOR || role === UserRole.OFFICE_ADMIN
}

export function canSeePastoralNotes(role: UserRole | undefined): boolean {
  return role === UserRole.ADMIN || role === UserRole.PASTOR
}

export function isAdmin(role: UserRole | undefined): boolean {
  return role === UserRole.ADMIN
}

export function canAccessAccounting(role: UserRole | undefined): boolean {
  return role === UserRole.ADMIN || role === UserRole.PASTOR
}

export function canViewAccounting(role: UserRole | undefined): boolean {
  return (
    role === UserRole.ADMIN ||
    role === UserRole.PASTOR ||
    role === UserRole.AUDITOR ||
    role === UserRole.OFFICE_ADMIN
  )
}

// User management — ADMIN and OFFICE_ADMIN. OFFICE_ADMIN cannot touch ADMIN
// targets or grant the ADMIN role; that is enforced server-side in user.ts.
export function canManageUsers(role: UserRole | undefined): boolean {
  return role === UserRole.ADMIN || role === UserRole.OFFICE_ADMIN
}

// ADMIN and PASTOR are "elevated": PASTOR carries canAccessAccounting
// (accounting mutations) + canSeePastoralNotes (member PII), both denied to
// OFFICE_ADMIN. Only an ADMIN may assign either role or modify an account that
// already holds one — otherwise an OFFICE_ADMIN could grant themselves PASTOR
// (self-escalation) or take over a PASTOR account by resetting its password
//. Enforced server-side in user.ts createUser/updateUser.
export function canAssignRole(actorRole: UserRole | undefined, targetRole: UserRole): boolean {
  if (isAdmin(actorRole)) return true
  return targetRole !== UserRole.ADMIN && targetRole !== UserRole.PASTOR
}

// AUDITOR is accounting-only — excluded so it never sees decrypted member PII.
export function canViewPeople(role: UserRole | undefined): boolean {
  return (
    role === UserRole.ADMIN ||
    role === UserRole.PASTOR ||
    role === UserRole.VIEWER ||
    role === UserRole.OFFICE_ADMIN
  )
}

/**
 * Upload / replace / verify / remove WWCC and Safe Ministry clearances, and
 * download the document + see the number. Equal to canEdit (ADMIN | PASTOR |
 * OFFICE_ADMIN) by PO decision; kept as its own helper so the rule can diverge.
 */
export function canManageClearances(role: UserRole | undefined): boolean {
  return canEdit(role)
}

/**
 * See a clearance's STATUS BADGE only: managers (full detail) plus VIEWER
 * (badge only, never the number, document or note). AUDITOR and EVENT_ORGANISER
 * see nothing.
 */
export function canViewClearanceStatus(role: UserRole | undefined): boolean {
  return canManageClearances(role) || role === UserRole.VIEWER
}

export function isEventOrganiser(role: UserRole | undefined): boolean {
  return role === UserRole.EVENT_ORGANISER
}

/**
 * Coarse, DB-free role pre-check for actions an editor or an assigned
 * organiser may run. The per-event/class assignment is checked separately.
 * @param role the caller's role
 */
export function canEditOrOrganise(role: UserRole | undefined): boolean {
  return canEdit(role) || isEventOrganiser(role)
}

/**
 * Create/edit event fundraisers, entries and payments, and send reminders.
 * Same set as canEdit (ADMIN | PASTOR | OFFICE_ADMIN).
 */
export function canManageFundraiser(role: UserRole | undefined): boolean {
  return role === UserRole.ADMIN || role === UserRole.PASTOR || role === UserRole.OFFICE_ADMIN
}

/**
 * Read-only view of fundraiser totals: managers plus AUDITOR. VIEWER and
 * EVENT_ORGANISER see nothing.
 */
export function canViewFundraiserTotals(role: UserRole | undefined): boolean {
  return canManageFundraiser(role) || role === UserRole.AUDITOR
}

/**
 * See the /groups list and group detail pages (read-only for VIEWER). Same set
 * as canViewPeople: a member list is member PII. AUDITOR and EVENT_ORGANISER
 * are excluded (organisers use /my-groups, gated per group).
 * @param role the caller's role
 */
export function canViewGroups(role: UserRole | undefined): boolean {
  return canViewPeople(role)
}

/**
 * Create, edit, archive any group, manage any group's members and assign
 * leader logins. ADMIN | PASTOR | OFFICE_ADMIN (= canEdit), kept separate so
 * the rule can diverge.
 * @param role the caller's role
 */
export function canManageGroups(role: UserRole | undefined): boolean {
  return canEdit(role)
}

/**
 * Enter, edit and delete service headcounts. ADMIN | PASTOR | OFFICE_ADMIN
 * (= canEdit), kept separate so the rule can diverge.
 * @param role the caller's role
 */
export function canEditAttendance(role: UserRole | undefined): boolean {
  return canEdit(role)
}

/**
 * See attendance trends and the dashboard tile (read-only for VIEWER). Same
 * set as canViewPeople; AUDITOR and EVENT_ORGANISER are excluded.
 * @param role the caller's role
 */
export function canViewAttendance(role: UserRole | undefined): boolean {
  return canViewPeople(role)
}
