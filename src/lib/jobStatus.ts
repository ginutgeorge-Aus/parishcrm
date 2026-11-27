import { prisma } from "@/lib/prisma"
import { schedulerEnabled } from "@/lib/schedulerFlag"

/**
 * Scheduler liveness + per-job last-success times, kept in AppSetting rows so
 * they survive restarts and are visible to every instance. Values are ISO
 * instants. No new table: one key per job, upserted.
 */
export const HEARTBEAT_KEY = "scheduler.heartbeat"
/** Three missed 5-minute ticks: the timer is stuck or the process is down. */
export const HEARTBEAT_STALE_MS = 15 * 60_000

/**
 * AppSetting key holding a job's last-success instant.
 * @param job - Scheduler job name.
 * @returns The setting key.
 */
export function lastSuccessKey(job: string): string {
  return `job.lastSuccess.${job}`
}

/** Upserts one setting value. */
async function put(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

/**
 * Saves "the scheduler ticked at `at`". Never throws: a DB blip must not stop the tick.
 * @param at - Tick instant.
 */
export async function recordHeartbeat(at: Date): Promise<void> {
  try {
    await put(HEARTBEAT_KEY, at.toISOString())
  } catch { /* the next tick writes it again */ }
}

/**
 * Saves a job's last full success. Never throws.
 * @param job - Scheduler job name.
 * @param at - Success instant.
 */
export async function recordJobSuccess(job: string, at: Date): Promise<void> {
  try {
    await put(lastSuccessKey(job), at.toISOString())
  } catch { /* status only: the job itself already finished */ }
}

/**
 * Reads a job's last-success instant.
 * @param job - Scheduler job name.
 * @returns The instant, or null when it never succeeded (or the row is unreadable).
 */
export async function readJobLastSuccess(job: string): Promise<Date | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: lastSuccessKey(job) } })
  const d = row ? new Date(row.value) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}

export type SchedulerHealth = "ok" | "stale" | "off" | "unknown"

/**
 * Coarse scheduler state for the public health probe (no timestamps: they aid
 * fingerprinting). "off" when the in-app scheduler is disabled, "unknown" before
 * the first tick (it starts one minute after boot) or when the DB read fails.
 * @param now - Current instant.
 * @param env - Environment flags.
 * @returns ok, stale, off or unknown.
 */
export async function schedulerHealth(now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<SchedulerHealth> {
  if (!schedulerEnabled(env)) return "off"
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: HEARTBEAT_KEY } })
    const at = row ? new Date(row.value).getTime() : NaN
    if (Number.isNaN(at)) return "unknown"
    return now.getTime() - at > HEARTBEAT_STALE_MS ? "stale" : "ok"
  } catch {
    return "unknown"
  }
}
