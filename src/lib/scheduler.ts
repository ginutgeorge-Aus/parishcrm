import { sydneyClock, sydneyWeekStartYMD } from "@/lib/dates"
import type { Env } from "@/lib/schedulerFlag"

export { schedulerEnabled, type Env } from "@/lib/schedulerFlag"

/**
 * Pure schedule for the in-app scheduler (see schedulerRunner.ts). No I/O, so
 * every "is it due?" decision is unit-testable against fixed instants. Times
 * are Sydney wall-clock. Interval jobs run every 30 min; period jobs run once
 * per Sydney day/week from an opening hour, retrying (30 min apart) until one
 * attempt fully succeeds. This in-memory state only avoids wasted work — the
 * jobs' own DB markers are what prevent duplicate sends after a restart.
 */
export type JobName = "reminders" | "checkouts" | "celebrations" | "errorDigest"
export type JobState = {
  lastStart: number | null
  lastSuccessKey: string | null // Sydney day / week of the last full success (period jobs only)
  running: boolean
}
export type SchedulerState = Record<JobName, JobState>

export const JOB_NAMES: readonly JobName[] = ["reminders", "checkouts", "celebrations", "errorDigest"]

const EVERY_MS = 30 * 60_000
const CELEBRATIONS_FROM_HOUR = 7
const DIGEST_FROM_HOUR = 9

export function initialState(): SchedulerState {
  const fresh = (): JobState => ({ lastStart: null, lastSuccessKey: null, running: false })
  return { reminders: fresh(), checkouts: fresh(), celebrations: fresh(), errorDigest: fresh() }
}

/** The period a success counts for: Sydney day (celebrations), Sydney week (digest), none (interval jobs). */
export function successKey(job: JobName, now: Date): string | null {
  if (job === "celebrations") return sydneyClock(now).ymd
  if (job === "errorDigest") return sydneyWeekStartYMD(now)
  return null
}

function windowOpen(job: JobName, now: Date, env: Env): boolean {
  const c = sydneyClock(now)
  if (job === "celebrations") return c.hour >= CELEBRATIONS_FROM_HOUR
  // GITHUB_TOKEN is also the feedback widget's credential, so the digest needs its own opt-in.
  if (env.ERROR_DIGEST !== "true" || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return false
  return c.weekday > 1 || c.hour >= DIGEST_FROM_HOUR
}

function isDue(job: JobName, now: Date, s: JobState, env: Env): boolean {
  const sinceStart = s.lastStart === null ? Infinity : now.getTime() - s.lastStart
  if (sinceStart < EVERY_MS) return false
  const key = successKey(job, now)
  if (key === null) return true
  return s.lastSuccessKey !== key && windowOpen(job, now, env)
}

export function dueJobs(now: Date, state: SchedulerState, env: Env = process.env): JobName[] {
  return JOB_NAMES.filter((j) => !state[j].running && isDue(j, now, state[j], env))
}
