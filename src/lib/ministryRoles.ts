import { MinistryRole } from "@/lib/generated/prisma/enums"

/**
 * Human labels for each ministry role. Pure and client-safe so the form,
 * profile badges and list filter all share one source.
 */
export const MINISTRY_ROLE_LABELS: Record<MinistryRole, string> = {
  STAFF: "Staff",
  VOLUNTEER: "Volunteer",
  SUNDAY_SCHOOL_TEACHER: "Sunday school teacher",
  YOUTH_LEADER: "Youth leader",
  CHILDREN_MINISTRY: "Children's ministry",
  OTHER: "Other",
}

/** Every ministry role in display order (form checkboxes, badges, filter). */
export const MINISTRY_ROLES: MinistryRole[] = [
  "STAFF",
  "VOLUNTEER",
  "SUNDAY_SCHOOL_TEACHER",
  "YOUTH_LEADER",
  "CHILDREN_MINISTRY",
  "OTHER",
]

const VALID = new Set<string>(Object.values(MinistryRole))

/**
 * Validate raw form values into a deduped `MinistryRole[]`, preserving
 * first-seen order. Returns `null` if ANY value is not a known role, so the
 * caller can reject the whole submission rather than silently drop input.
 */
export function parseMinistryRoles(values: string[]): MinistryRole[] | null {
  const out: MinistryRole[] = []
  for (const v of values) {
    if (!VALID.has(v)) return null
    if (!out.includes(v as MinistryRole)) out.push(v as MinistryRole)
  }
  return out
}

/**
 * Parse a single `?ministryRole=` URL filter value. Unknown or empty values
 * mean "no filter" (null), matching how the other People filters degrade.
 */
export function parseMinistryRoleFilter(value: string | null | undefined): MinistryRole | null {
  return value && VALID.has(value) ? (value as MinistryRole) : null
}
