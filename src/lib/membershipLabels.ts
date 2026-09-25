import { MembershipStatus } from "@/lib/generated/prisma/enums"

/** Humanized display label for a membership application's status. */
export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
}
