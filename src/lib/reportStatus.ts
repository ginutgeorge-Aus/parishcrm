import type { ReportStatus } from "@/lib/generated/prisma/enums"

// Newest reports the /reports page lists (and syncMyReports refreshes); older
// ones stay in the DB but aren't shown.
export const MAX_LISTED_REPORTS = 50

// Maps a GitHub issue's state to the reporter-facing Report status.
// closed + not_planned = the maintainer declined it ("won't fix"); any other
// closed reason is treated as resolved. Open stays open.
export function issueStateToStatus(
  state: "open" | "closed",
  stateReason: string | null
): ReportStatus {
  if (state !== "closed") return "OPEN"
  return stateReason === "not_planned" ? "DECLINED" : "RESOLVED"
}
