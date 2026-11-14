// Display labels and filter parsing for the pastoral pages (#305). Pure, so
// the pages, client components and tests share one source.

import { FollowUpStatus, PrayerRequestStatus } from "@/lib/generated/prisma/enums"

/** Display names for follow-up statuses. */
export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
}

/** Display names for prayer request statuses. */
export const PRAYER_STATUS_LABEL: Record<PrayerRequestStatus, string> = {
  ACTIVE: "Active",
  ANSWERED: "Answered",
  ARCHIVED: "Archived",
}

/** Status filter choices on /follow-ups. `open` is the default (still to do). */
const FOLLOW_UP_STATUS_FILTERS = ["open", "done", "all"] as const
export type FollowUpStatusFilter = (typeof FOLLOW_UP_STATUS_FILTERS)[number]

const OPEN_STATUSES: FollowUpStatus[] = [FollowUpStatus.OPEN, FollowUpStatus.IN_PROGRESS]
const CLOSED_STATUSES: FollowUpStatus[] = [FollowUpStatus.DONE, FollowUpStatus.CANCELLED]

/**
 * Parse the `status` search param; anything unknown falls back to `open`.
 * @param raw raw search-param value
 */
export function parseFollowUpStatusFilter(raw: string | string[] | undefined): FollowUpStatusFilter {
  const v = Array.isArray(raw) ? raw[0] : raw
  return (FOLLOW_UP_STATUS_FILTERS as readonly string[]).includes(v ?? "") ? (v as FollowUpStatusFilter) : "open"
}

/**
 * Statuses a filter choice stands for (`undefined` = no status filter).
 * @param filter the parsed status filter
 */
export function followUpStatusesFor(filter: FollowUpStatusFilter): FollowUpStatus[] | undefined {
  if (filter === "open") return OPEN_STATUSES
  if (filter === "done") return CLOSED_STATUSES
  return undefined
}

/** Assignee filter on /follow-ups: everyone, the viewer's own, unassigned, or one login id. */
export type AssigneeFilter = "all" | "mine" | "unassigned" | number

/**
 * Parse the `assignee` search param; anything unknown falls back to `all`.
 * @param raw raw search-param value
 */
export function parseAssigneeFilter(raw: string | string[] | undefined): AssigneeFilter {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (v === "mine" || v === "unassigned") return v
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : "all"
}
