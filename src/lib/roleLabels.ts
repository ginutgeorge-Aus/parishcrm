import type { UserRole } from "@/lib/generated/prisma/enums"

/** Display label per user role, shared by the Users page and the sidebar user menu. */
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  PASTOR: "Pastor",
  VIEWER: "Viewer",
  AUDITOR: "Auditor",
  OFFICE_ADMIN: "Office Admin",
  EVENT_ORGANISER: "Event Organiser",
}
