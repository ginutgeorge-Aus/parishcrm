import { sydneyTodayYMD, sydneyWeekStartYMD } from "@/lib/dates"
import { dueJobs, initialState, type JobName, type SchedulerState } from "@/lib/scheduler"

/**
 * In-app scheduler: one timer per process, started from instrumentation.ts.
 * Replaces external cron services; the /api/cron/* routes remain as manual
 * triggers. Jobs run one after another; each is isolated so a throw is logged
 * and retried on a later tick, never crashing the process.
 */
export const TICK_MS = 5 * 60_000
export const FIRST_TICK_MS = 60_000
export type Jobs = Record<JobName, (now: Date) => Promise<unknown>>

// Dynamic imports keep Prisma/email out of instrumentation's boot path until a job runs.
const DEFAULT_JOBS: Jobs = {
  reminders: async (now) => (await import("@/lib/reminderSweep")).runReminderSweep(now),
  checkouts: async () => (await import("@/lib/checkoutSweep")).sweepExpiredCheckouts(),
  celebrations: async (now) => (await import("@/lib/celebrationSweep")).runCelebrationSweep(now),
  errorDigest: async (now) => (await import("@/lib/errorDigest")).runErrorDigest(now),
}

// Keep only numbers (recursively) so a result can never leak a name or email into logs.
function countsOnly(v: unknown): unknown {
  if (typeof v === "number") return v
  if (!v || typeof v !== "object") return undefined
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    const c = countsOnly(x)
    if (c !== undefined) out[k] = c
  }
  return out
}

async function runJob(name: JobName, state: SchedulerState, fn: Jobs[JobName], now: Date): Promise<void> {
  const s = state[name]
  s.lastStart = now.getTime()
  const t0 = Date.now()
  try {
    const result = await fn(now)
    s.lastSuccessDay = sydneyTodayYMD(now)
    s.lastSuccessWeek = sydneyWeekStartYMD(now)
    console.log(JSON.stringify({ level: "info", source: "scheduler", job: name, ms: Date.now() - t0, result: countsOnly(result) }))
  } catch (err) {
    console.error(JSON.stringify({ level: "error", source: "scheduler", job: name, ms: Date.now() - t0, message: err instanceof Error ? err.message : String(err) }))
  } finally {
    s.running = false
  }
}

export async function tick(state: SchedulerState, jobs: Jobs, now: Date = new Date()): Promise<void> {
  const due = dueJobs(now, state)
  // Claim every due job before awaiting any, so an overlapping tick can't pick one up too.
  for (const name of due) state[name].running = true
  for (const name of due) await runJob(name, state, jobs[name], now)
}

const GUARD = "__parishcrmScheduler"

/** Starts the timer once per process (the globalThis guard survives dev HMR). Returns false if already started. */
export function startScheduler(jobs: Jobs = DEFAULT_JOBS): boolean {
  const g = globalThis as Record<string, unknown>
  if (g[GUARD]) return false
  g[GUARD] = true
  const state = initialState()
  const run = () => void tick(state, jobs)
  setTimeout(() => {
    run()
    setInterval(run, TICK_MS).unref()
  }, FIRST_TICK_MS).unref()
  console.log(JSON.stringify({ level: "info", source: "scheduler", message: "in-app scheduler started" }))
  return true
}
