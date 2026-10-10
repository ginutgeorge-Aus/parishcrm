import { sydneyClock, sydneyMonthKey, sydneyWeekStartYMD } from "@/lib/dates"
import type { Env } from "@/lib/schedulerFlag"

export { schedulerEnabled, type Env } from "@/lib/schedulerFlag"

/**
 * Pure schedule for the in-app scheduler (see schedulerRunner.ts). No I/O, so
 * every "is it due?" decision is unit-testable against fixed instants. Times
 * are Sydney wall-clock. Interval jobs run every 30 min; period jobs run once
 * per Sydney day/week/month from an opening hour, retrying (30 min apart, at most 3 times per
 * period; the clearance digest's budget is per Sydney day) until one attempt fully succeeds. This in-memory state only avoids wasted work — the
 * jobs' own DB markers are what prevent duplicate sends after a restart.
 */
export type JobName = "reminders" | "checkouts" | "celebrations" | "errorDigest" | "clearanceDigest"
type JobState = {
  lastStart: number | null
  lastSuccessKey: string | null // Sydney day / week of the last full success (period jobs only)
  attempts: { key: string | null; count: number } // attempts within the current period
  running: boolean
}
export type SchedulerState = Record<JobName, JobState>

const JOB_NAMES: readonly JobName[] = ["reminders", "checkouts", "celebrations", "errorDigest", "clearanceDigest"]

const EVERY_MS = 30 * 60_000
const CELEBRATIONS_FROM_HOUR = 7
const DIGEST_FROM_HOUR = 9
const CLEARANCE_DIGEST_FROM_HOUR = 7
// A permanently failing recipient must not be retried all day/week.
const MAX_ATTEMPTS_PER_PERIOD = 3

export function initialState(): SchedulerState {
  const fresh = (): JobState => ({ lastStart: null, lastSuccessKey: null, attempts: { key: null, count: 0 }, running: false })
  return { reminders: fresh(), checkouts: fresh(), celebrations: fresh(), errorDigest: fresh(), clearanceDigest: fresh() }
}

/**
 * The period a success counts for: Sydney day (celebrations), Sydney week (error digest),
 * Sydney month (clearance digest), none (interval jobs).
 * @param job - Job to key.
 * @param now - Current instant.
 * @returns Period key, or null for interval jobs.
 */
export function successKey(job: JobName, now: Date): string | null {
  if (job === "celebrations") return sydneyClock(now).ymd
  if (job === "errorDigest") return sydneyWeekStartYMD(now)
  if (job === "clearanceDigest") return sydneyMonthKey(now)
  return null
}

/**
 * The period the 3-attempt cap counts within. Same as the success period,
 * except the clearance digest (monthly success, open for 7 days) gets a fresh
 * budget each Sydney day so failures on the 1st cannot burn the whole month.
 * @param job - Job to key.
 * @param now - Current instant.
 * @returns Attempt-budget key, or null for interval jobs.
 */
function attemptKey(job: JobName, now: Date): string | null {
  return job === "clearanceDigest" ? sydneyClock(now).ymd : successKey(job, now)
}

/**
 * Whether the job's Sydney-time window is open at `now`.
 * @param job - Job to check.
 * @param now - Current instant.
 * @param env - Environment flags.
 * @returns True when the job may run.
 */
function windowOpen(job: JobName, now: Date, env: Env): boolean {
  const c = sydneyClock(now)
  if (job === "celebrations") return c.hour >= CELEBRATIONS_FROM_HOUR
  // Monthly: opens on the 1st (Sydney) from 07:00 and stays open to the end of
  // the 7th, so an outage on the 1st catches up; the Sydney-month success key
  // sends once, and the 3-attempt cap applies per Sydney day. Opt-in like the
  // error digest (CLEARANCE_DIGEST=true); the manual cron route needs no flag.
  if (job === "clearanceDigest") {
    if (env.CLEARANCE_DIGEST !== "true") return false
    const day = Number(c.ymd.slice(8, 10))
    return day <= 7 && (day > 1 || c.hour >= CLEARANCE_DIGEST_FROM_HOUR)
  }
  // GITHUB_TOKEN is also the feedback widget's credential, so the digest needs its own opt-in.
  if (env.ERROR_DIGEST !== "true" || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return false
  return c.weekday > 1 || c.hour >= DIGEST_FROM_HOUR
}

function isDue(job: JobName, now: Date, s: JobState, env: Env): boolean {
  const sinceStart = s.lastStart === null ? Infinity : now.getTime() - s.lastStart
  if (sinceStart < EVERY_MS) return false
  const key = successKey(job, now)
  if (key === null) return true
  if (s.attempts.key === attemptKey(job, now) && s.attempts.count >= MAX_ATTEMPTS_PER_PERIOD) return false
  return s.lastSuccessKey !== key && windowOpen(job, now, env)
}

/** Record that a job is starting now (spacing + per-period attempt budget). */
export function recordStart(job: JobName, state: SchedulerState, now: Date): void {
  const s = state[job]
  s.lastStart = now.getTime()
  const key = attemptKey(job, now)
  if (key === null) return
  if (s.attempts.key !== key) s.attempts = { key, count: 0 }
  s.attempts.count++
}

export function dueJobs(now: Date, state: SchedulerState, env: Env = process.env): JobName[] {
  return JOB_NAMES.filter((j) => !state[j].running && isDue(j, now, state[j], env))
}
