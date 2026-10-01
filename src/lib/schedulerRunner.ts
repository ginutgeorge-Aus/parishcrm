import { dueJobs, initialState, recordStart, successKey, type JobName, type SchedulerState } from "@/lib/scheduler"

/**
 * In-app scheduler: one timer per process, started from instrumentation.ts.
 * Replaces external cron services; the /api/cron/* routes remain as manual
 * triggers. Due jobs run concurrently; each is isolated so a throw is logged
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
  errorDigest: async (now) => (await import("@/lib/errorDigest")).runErrorDigestOncePerWeek(now),
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

// A sweep that catches per-recipient errors reports them as `failed`/`emailsFailed`
// counts instead of throwing; any non-zero one means the period isn't done yet.
function reportsFailures(v: unknown): boolean {
  if (!v || typeof v !== "object") return false
  return Object.entries(v).some(([k, x]) =>
    typeof x === "number" ? /failed/i.test(k) && x > 0 : reportsFailures(x))
}

function log(level: "info" | "error", fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, source: "scheduler", ...fields })
  if (level === "error") console.error(line)
  else console.log(line)
}

async function runJob(name: JobName, state: SchedulerState, fn: Jobs[JobName], now: Date): Promise<void> {
  const s = state[name]
  recordStart(name, state, now)
  const t0 = Date.now()
  try {
    const result = await fn(now)
    const ms = Date.now() - t0
    if (reportsFailures(result)) {
      log("error", { job: name, ms, message: "completed with failed sends — will retry", result: countsOnly(result) })
      return
    }
    s.lastSuccessKey = successKey(name, now)
    log("info", { job: name, ms, result: countsOnly(result) })
  } catch (err) {
    log("error", { job: name, ms: Date.now() - t0, message: err instanceof Error ? err.message : String(err) })
  } finally {
    s.running = false
  }
}

export async function tick(state: SchedulerState, jobs: Jobs, now: Date = new Date()): Promise<void> {
  // Never reject: an unhandled rejection from the timer would take down the web server.
  try {
    const due = dueJobs(now, state)
    // Claim every due job before awaiting any, so an overlapping tick can't pick one up too.
    for (const name of due) state[name].running = true
    // Concurrent, not sequential: a hung job must not hold back (or keep claimed) the others.
    await Promise.all(due.map((name) => runJob(name, state, jobs[name], now)))
  } catch (err) {
    log("error", { message: `tick failed: ${err instanceof Error ? err.message : String(err)}` })
  }
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
  // The timer only fires while the process is up — say so once, since a host that
  // scales to zero would otherwise stop every job without a signal.
  log("info", { message: "in-app scheduler started — keep the app always on, or set IN_APP_CRON=false and call /api/cron/* externally" })
  return true
}
