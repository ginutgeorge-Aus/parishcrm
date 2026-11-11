// Groups & ministries (#303): pure helpers shared by actions, pages and tests.

import { z } from "zod"
import type { GroupCategory, GroupMemberRole } from "@/lib/generated/prisma/enums"

export const GROUP_CATEGORY_LABELS: Record<GroupCategory, string> = {
  MINISTRY: "Ministry",
  COMMITTEE: "Committee",
  FELLOWSHIP: "Fellowship",
  OTHER: "Other",
}

export const GROUP_ROLE_LABELS: Record<GroupMemberRole, string> = {
  LEADER: "Leader",
  MEMBER: "Member",
}

export const GROUP_CATEGORIES = ["MINISTRY", "COMMITTEE", "FELLOWSHIP", "OTHER"] as const satisfies readonly GroupCategory[]
export const GROUP_ROLES = ["LEADER", "MEMBER"] as const satisfies readonly GroupMemberRole[]

export const MAX_GROUP_NAME = 100
export const MAX_GROUP_DESCRIPTION = 1000
export const MAX_MEMBER_TITLE = 60
/** Shortest person-search query (avoids listing the whole roll to an organiser). */
export const MIN_PERSON_SEARCH = 2
/** People returned per person-search call. */
export const PERSON_SEARCH_LIMIT = 20
/** Members shown on a group page / print view / CSV, as a defensive cap. */
export const MAX_GROUP_MEMBERS = 5000

export const GroupFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(MAX_GROUP_NAME, `Name must be ${MAX_GROUP_NAME} characters or fewer`),
  category: z.enum(GROUP_CATEGORIES, { error: "Pick a category" }),
  description: z.string().trim().max(MAX_GROUP_DESCRIPTION, `Description must be ${MAX_GROUP_DESCRIPTION} characters or fewer`).default(""),
})

export const MemberFieldsSchema = z.object({
  role: z.enum(GROUP_ROLES, { error: "Invalid role" }),
  title: z.string().trim().max(MAX_MEMBER_TITLE, `Title must be ${MAX_MEMBER_TITLE} characters or fewer`).default(""),
})

/**
 * Parse a `?category=` filter value; anything other than a known category is
 * null (no filter), so a crafted link can't reach Prisma with a bad enum.
 * @param raw the raw query value
 */
export function parseCategoryFilter(raw: string | undefined): GroupCategory | null {
  return raw && (GROUP_CATEGORIES as readonly string[]).includes(raw) ? (raw as GroupCategory) : null
}

/** Sort members leaders first, then by surname and first name. */
export function sortMembers<T extends { role: GroupMemberRole; lastName: string; firstName: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    (a.role === b.role ? 0 : a.role === "LEADER" ? -1 : 1)
    || a.lastName.localeCompare(b.lastName)
    || a.firstName.localeCompare(b.firstName))
}

/** One row of the members panel (no contact details). */
export type MemberRow = { personId: number; name: string; familyName: string; role: GroupMemberRole; title: string }

/** One CSV/print row of a group member. Contact fields are already decrypted. */
export type GroupMemberExportRow = {
  firstName: string
  lastName: string
  familyName: string
  role: GroupMemberRole
  title: string
  joinedAt: Date
  email: string
  mobile: string
}

export const GROUP_CSV_HEADERS = ["Surname", "Given name", "Family", "Role", "Title", "Joined", "Email", "Mobile"]

/** "2026-11-11" for the joined date (UTC, the stored instant's date). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Raw cell values for the member CSV, one array per member (header first).
 * Callers must pass every cell through `escapeCsv` (formula-injection guard).
 * @param rows members, already sorted
 */
export function groupCsvCells(rows: GroupMemberExportRow[]): string[][] {
  return [
    GROUP_CSV_HEADERS,
    ...rows.map((r) => [r.lastName, r.firstName, r.familyName, GROUP_ROLE_LABELS[r.role], r.title, ymd(r.joinedAt), r.email, r.mobile]),
  ]
}
