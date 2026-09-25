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

export function isEventOrganiser(role: UserRole | undefined): boolean {
  return role === UserRole.EVENT_ORGANISER
}
