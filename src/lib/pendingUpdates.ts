import { cache } from "react"
import { prisma } from "@/lib/prisma"

// React cache dedupes within a single render pass. The dashboard layout
// (Sidebar badge) and the dashboard page ("Needs attention" tile) both need the
// pending family-update count on every "/" load — without this they each issue
// an identical DB count, doubling the round-trip.
// Filter out submissions for archived families to match the inbox listing
// (FamilyUpdatesInbox), so the sidebar badge / dashboard tile count can't
// exceed the number of rows an admin can actually action.
export const countPendingFamilyUpdates = cache(() =>
  prisma.familyUpdateSubmission.count({
    where: { status: "PENDING", family: { archivedAt: null } },
  })
)
