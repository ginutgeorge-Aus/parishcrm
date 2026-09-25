import { FamilyStatus } from "@/lib/generated/prisma/enums"

/** Humanized display labels for the Family enums. */
export const FAMILY_STATUS_LABELS: Record<FamilyStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  VISITOR: "Visitor",
}
