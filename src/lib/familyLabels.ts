import { FamilyStatus } from "@/lib/generated/prisma/enums"

/** Humanized display labels for the Family enums. */
export const FAMILY_STATUS_LABELS: Record<FamilyStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  VISITOR: "Visitor",
}

/** Display labels for the `Gender` enum (AUD-8-15). */
export const GENDER_LABELS: Record<string, string> = {
  MALE: "Male",
  FEMALE: "Female",
  OTHER: "Other",
}

/**
 * Human label for a stored gender value; unknown values pass through unchanged, null/empty stays null.
 * @param gender raw `Gender` enum value from the database
 */
export function genderLabel(gender: string | null | undefined): string | null {
  if (!gender) return null
  return GENDER_LABELS[gender] ?? gender
}
