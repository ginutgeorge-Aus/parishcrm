// Volunteer roster rules (#621, part of #306): pure functions over plain
// objects, no DB. Conflict check (unavailable, already rostered at the
// service), open places in a slot, and the least-recently-served suggestion.
// Dates are `YYYY-MM-DD` Sydney calendar days, so string order is date order.
// Form schemas live here too, shared by the actions and (later) the pages.

import { z } from "zod"
import { isRealCalendarDate } from "@/lib/validation"
import { isValidDatetimeLocal, sydneyDatetimeLocalToUTC } from "@/lib/dates"
import type { RosterAssignmentStatus, RosterServiceKind } from "@/lib/generated/prisma/enums"

/** Why a person cannot take a slot. */
export type RosterConflict = "UNAVAILABLE" | "ALREADY_ASSIGNED"

/** An inclusive date range a person cannot serve, as `YYYY-MM-DD`. */
export interface UnavailableRange {
  startYMD: string
  endYMD: string
}

/** What the conflict check needs to know about one service. */
export interface ServiceContext {
  /** The service's Sydney calendar date, `YYYY-MM-DD`. */
  serviceYMD: string
  /** Everyone already rostered at this service, in any slot and any status. */
  assignedPersonIds: ReadonlySet<number>
  /** Unavailability per person; a missing key means none. */
  unavailability: ReadonlyMap<number, readonly UnavailableRange[]>
}

/** One eligible person (a live member of the role's group). */
export interface RosterCandidate {
  personId: number
  firstName: string
  lastName: string
}

/** A suggested person, with when they last served in this role (null = never). */
export interface RosterSuggestion extends RosterCandidate {
  lastServedYMD: string | null
}

export const ROSTER_CONFLICT_MESSAGES: Record<RosterConflict, string> = {
  UNAVAILABLE: "This person is unavailable on that date",
  ALREADY_ASSIGNED: "This person is already rostered at this service",
}

/** Default number of suggestions returned for a slot. */
export const DEFAULT_SUGGESTION_LIMIT = 5

/**
 * True when `ymd` falls inside any range (both ends inclusive).
 * @param ranges the person's unavailable ranges
 * @param ymd the day to test, `YYYY-MM-DD`
 */
export function isUnavailableOn(ranges: readonly UnavailableRange[], ymd: string): boolean {
  return ranges.some((r) => r.startYMD <= ymd && ymd <= r.endYMD)
}

/**
 * Why `personId` cannot be rostered at this service, or null when they can.
 * Already rostered wins over unavailable: it is the harder block (the DB
 * unique key also refuses it).
 * @param personId the person to check
 * @param ctx the service's date, current roster and unavailability
 */
export function findConflict(personId: number, ctx: ServiceContext): RosterConflict | null {
  if (ctx.assignedPersonIds.has(personId)) return "ALREADY_ASSIGNED"
  if (isUnavailableOn(ctx.unavailability.get(personId) ?? [], ctx.serviceYMD)) return "UNAVAILABLE"
  return null
}

/**
 * Places still open in a slot: `needed` minus assignments that still hold a
 * place. A DECLINED assignment frees its place. Never below zero.
 * @param needed people the slot needs
 * @param statuses statuses of the slot's assignments
 */
export function openPlaces(needed: number, statuses: readonly RosterAssignmentStatus[]): number {
  const held = statuses.filter((s) => s !== "DECLINED").length
  return Math.max(0, needed - held)
}

/**
 * Suggest who to roster: eligible people with no conflict, least recently
 * served in this role first. Never served sorts before any date; ties break
 * by surname, first name, then id, so the order is stable.
 * @param candidates the role's eligible people
 * @param lastServed last day each person served in this role (`YYYY-MM-DD`); missing = never
 * @param ctx the service's date, current roster and unavailability
 * @param limit max suggestions (default {@link DEFAULT_SUGGESTION_LIMIT})
 */
export function suggestAssignees(
  candidates: readonly RosterCandidate[],
  lastServed: ReadonlyMap<number, string>,
  ctx: ServiceContext,
  limit: number = DEFAULT_SUGGESTION_LIMIT,
): RosterSuggestion[] {
  if (limit <= 0) return []
  const seen = new Set<number>()
  const out: RosterSuggestion[] = []
  for (const c of candidates) {
    if (seen.has(c.personId) || findConflict(c.personId, ctx) !== null) continue
    seen.add(c.personId)
    out.push({ ...c, lastServedYMD: lastServed.get(c.personId) ?? null })
  }
  out.sort((a, b) => compareLastServed(a.lastServedYMD, b.lastServedYMD)
    || a.lastName.localeCompare(b.lastName)
    || a.firstName.localeCompare(b.firstName)
    || a.personId - b.personId)
  return out.slice(0, limit)
}

/** Order last-served days oldest first, with never (null) before any day. */
function compareLastServed(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a < b ? -1 : 1
}

// ─── Form schemas ─────────────────────────────────────────────────────────

export const MAX_ROSTER_ROLE_NAME = 80
export const MAX_ROSTER_TITLE = 120
export const MAX_ROSTER_LOCATION = 120
/** Upper bound on people per slot: a defensive cap, not a product rule. */
export const MAX_SLOT_NEEDED = 50
/** Most Sundays one generator run may create (about six months). */
export const MAX_SUNDAYS_PER_RUN = 26
export const DEFAULT_SUNDAY_TITLE = "Sunday service"

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const ymd = z.string().refine(isRealCalendarDate, "Enter a valid date")
const hhmm = z.string().regex(HHMM_RE, "Enter a valid time")
const count = (label: string) => z.coerce.number().int(`${label} must be a whole number`)
  .min(1, `${label} must be at least 1`).max(MAX_SLOT_NEEDED, `${label} must be ${MAX_SLOT_NEEDED} or fewer`)

export const RosterRoleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(MAX_ROSTER_ROLE_NAME, `Name must be ${MAX_ROSTER_ROLE_NAME} characters or fewer`),
  groupId: z.coerce.number().int().positive("Pick a group").max(2147483647, "Pick a group"),
  defaultCount: count("People needed").default(1),
})

const SERVICE_TIME_FIELDS = {
  startTime: hhmm,
  endTime: hhmm,
  location: z.string().trim().max(MAX_ROSTER_LOCATION, `Location must be ${MAX_ROSTER_LOCATION} characters or fewer`).default(""),
}

export const RosterServiceSchema = z.object({
  kind: z.enum(["SUNDAY", "ADHOC"] as const satisfies readonly RosterServiceKind[], { error: "Pick a service type" }),
  title: z.string().trim().min(1, "Title is required").max(MAX_ROSTER_TITLE, `Title must be ${MAX_ROSTER_TITLE} characters or fewer`),
  date: ymd,
  ...SERVICE_TIME_FIELDS,
})

export const SundayRangeSchema = z.object({
  from: ymd,
  to: ymd,
  title: z.string().trim().max(MAX_ROSTER_TITLE, `Title must be ${MAX_ROSTER_TITLE} characters or fewer`).default(""),
  ...SERVICE_TIME_FIELDS,
})

/** Slot head-count input. */
export const SlotNeededSchema = count("People needed")

/** The UTC instants and storage date for a service on a Sydney day and times. */
export interface ServiceTimes {
  /** The Sydney calendar day at UTC midnight (the `@db.Date` value). */
  date: Date
  startsAt: Date
  endsAt: Date
}

/**
 * Turn a Sydney calendar day and wall-clock start/end times into stored
 * values. Returns an error message when a time is invalid or the end is not
 * after the start (a service does not run past midnight).
 * @param dateYMD the service day, `YYYY-MM-DD`
 * @param startTime start, `HH:mm` Sydney time
 * @param endTime end, `HH:mm` Sydney time
 */
export function serviceTimes(dateYMD: string, startTime: string, endTime: string): ServiceTimes | { error: string } {
  const startLocal = `${dateYMD}T${startTime}`
  const endLocal = `${dateYMD}T${endTime}`
  if (!isValidDatetimeLocal(startLocal) || !isValidDatetimeLocal(endLocal)) return { error: "Enter a valid date and time" }
  const startsAt = sydneyDatetimeLocalToUTC(startLocal)
  const endsAt = sydneyDatetimeLocalToUTC(endLocal)
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return { error: "Enter a valid date and time" }
  if (endsAt.getTime() <= startsAt.getTime()) return { error: "End time must be after the start time" }
  return { date: new Date(`${dateYMD}T00:00:00.000Z`), startsAt, endsAt }
}

/**
 * True when `YYYY-MM-DD` is a Sunday. UTC-anchored, so the server timezone
 * does not matter.
 * @param dateYMD the day to test
 */
export function isSundayYMD(dateYMD: string): boolean {
  return new Date(`${dateYMD}T00:00:00.000Z`).getUTCDay() === 0
}
