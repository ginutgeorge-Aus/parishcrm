import { sydneyClock, sydneyWeekStartYMD } from "@/lib/dates"
import type { Env } from "@/lib/schedulerFlag"

export { schedulerEnabled, type Env } from "@/lib/schedulerFlag"

/**
 * Pure schedule for the in-app scheduler (see schedulerRunner.ts). No I/O, so
 * every "is it due?" decision is unit-testable against fixed instants. Times
 * are Sydney wall-clock; the jobs' own DB markers (reminder leases, celebration
 * claims, issue fingerprints) make a repeated run harmless, so this in-memory
 * state only avoids wasted work, it is not what prevents duplicates.
 */
export type JobName = "reminders" | "checkouts" | "celebrations" | "errorDigest"
export type JobState = {
  lastStart: number | null
  lastSuccessDay: string | null
  lastSuccessWeek: string | null
  running: boolean
}
export type SchedulerState = Record<JobName, JobState>

export const JOB_NAMES: readonly JobName[] = ["reminders", "checkouts", "celebrations", "errorDigest"]

const EVERY_MS = 30 * 60_000
const CELEBRATIONS_FROM_HOUR = 7
const DIGEST_FROM_HOUR = 9

export function initialState(): SchedulerState {
  const fresh = (): JobState => ({ lastStart: null, lastSuccessDay: null, lastSuccessWeek: null, running: false })
  return { reminders: fresh(), checkouts: fresh(), celebrations: fresh(), errorDigest: fresh() }
}

function isDue(job: JobName, now: Date, s: JobState, env: Env): boolean {
  switch (job) {
    case "reminders":
    case "checkouts":
      return s.lastStart === null || now.getTime() - s.lastStart >= EVERY_MS
    case "celebrations": {
      const c = sydneyClock(now)
      return c.hour >= CELEBRATIONS_FROM_HOUR && s.lastSuccessDay !== c.ymd
    }
    case "errorDigest": {
      if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return false
      if (s.lastSuccessWeek === sydneyWeekStartYMD(now)) return false
      const c = sydneyClock(now)
      return c.weekday > 1 || c.hour >= DIGEST_FROM_HOUR
    }
  }
}

export function dueJobs(now: Date, state: SchedulerState, env: Env = process.env): JobName[] {
  return JOB_NAMES.filter((j) => !state[j].running && isDue(j, now, state[j], env))
}
