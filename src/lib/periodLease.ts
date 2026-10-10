import { prisma } from "@/lib/prisma"
import { isP2002 } from "@/lib/validation"
import { withRetry } from "@/lib/retry"

const LEASE_PREFIX = "running:"

export type OncePerPeriodOptions<T> = {
  /** AppSetting key holding the done-period marker or the lease. */
  settingKey: string
  /** The period this run covers, e.g. a Sydney week start or `YYYY-MM`. */
  periodKey: string
  /** How long a lease counts as held; an older one may be reclaimed. Renewed every `leaseMs / 3` while the run is active. */
  leaseMs: number
  now: Date
  /** Run even when the period is already done (still never concurrently). */
  force?: boolean
  /** True when the result should leave the period open for a retry (the lease is released). */
  keepOpen?: (result: T) => boolean
  /** Error sink for release/finalize failures; never throws. */
  logError: (message: string) => void
}

/** True while `value` is a lease younger than `leaseMs` (`running:<period>:<ms>`). */
function freshLease(value: string, now: Date, leaseMs: number): boolean {
  if (!value.startsWith(LEASE_PREFIX)) return false
  const startedAt = Number(value.slice(value.lastIndexOf(":") + 1))
  return Number.isFinite(startedAt) && now.getTime() - startedAt < leaseMs
}

/**
 * Keeps this run's lease fresh while `fn` runs: every third of `leaseMs` it
 * compare-and-sets the lease to `running:<period>:<now>`, so a run that
 * outlives `leaseMs` can't be reclaimed and repeated by another invocation.
 * A failed write is logged and retried on the next tick (the old lease still
 * stands); losing the CAS means another run took over, so renewal stops.
 * @param opts the run's options (key, period, lease length, error sink)
 * @param initial the lease value this run acquired
 * @returns `current()` for the latest lease value and `stop()`, which also waits for an in-flight renewal
 */
function startHeartbeat<T>(opts: OncePerPeriodOptions<T>, initial: string) {
  let current = initial
  let inFlight: Promise<void> | null = null
  const timer = setInterval(() => {
    if (inFlight) return
    const next = `${LEASE_PREFIX}${opts.periodKey}:${Date.now()}`
    inFlight = prisma.appSetting
      .updateMany({ where: { key: opts.settingKey, value: current }, data: { value: next } })
      .then(({ count }) => {
        if (count > 0) {
          current = next
          return
        }
        clearInterval(timer)
        opts.logError(`lease lost for ${opts.periodKey}: another run took it over`)
      })
      .catch((e: unknown) => {
        opts.logError(`lease renewal failed: ${e instanceof Error ? e.message : String(e)}`)
      })
      .finally(() => { inFlight = null })
  }, opts.leaseMs / 3)
  timer.unref?.()
  return {
    current: () => current,
    async stop() {
      clearInterval(timer)
      await inFlight
    },
  }
}

/**
 * Puts the setting back to what it was before this run's lease (best effort,
 * never throws, so a failed release can't mask the original error).
 * @param opts the run's options (key, lease length, error sink)
 * @param prevValue the setting value before the lease, or null when there was none
 * @param lease the lease value this run wrote
 */
async function releaseLease<T>(opts: OncePerPeriodOptions<T>, prevValue: string | null, lease: string): Promise<void> {
  const restoreTo = prevValue && !prevValue.startsWith(LEASE_PREFIX) ? prevValue : null
  try {
    if (restoreTo) {
      await prisma.appSetting.updateMany({ where: { key: opts.settingKey, value: lease }, data: { value: restoreTo } })
    } else {
      await prisma.appSetting.deleteMany({ where: { key: opts.settingKey, value: lease } })
    }
  } catch (e) {
    opts.logError(`lease release failed (expires in ${opts.leaseMs / 60_000} min): ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Compare-and-sets the lease into the setting row (or creates it).
 * @param settingKey AppSetting key
 * @param prevValue the value read before, or null when there was no row
 * @param lease the lease value to write
 * @returns false when another run won the race
 */
async function acquireLease(settingKey: string, prevValue: string | null, lease: string): Promise<boolean> {
  if (prevValue !== null) {
    const { count } = await prisma.appSetting.updateMany({ where: { key: settingKey, value: prevValue }, data: { value: lease } })
    return count > 0
  }
  try {
    await prisma.appSetting.create({ data: { key: settingKey, value: lease } })
    return true
  } catch (e) {
    if (isP2002(e)) return false
    throw e
  }
}

/**
 * Swaps this run's lease for the done marker, retried; never throws (the
 * work's side effects already happened), only logs.
 * @param opts the run's options (key, period, error sink)
 * @param lease the lease value this run wrote
 */
async function markDone<T>(opts: OncePerPeriodOptions<T>, lease: string): Promise<void> {
  try {
    await withRetry(
      () => prisma.appSetting.updateMany({ where: { key: opts.settingKey, value: lease }, data: { value: opts.periodKey } }),
      { attempts: 3, baseDelayMs: 200 },
    )
  } catch (e) {
    opts.logError(`ran but failed to mark ${opts.periodKey} done: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Runs `fn` at most once per period and never concurrently, guarded by one
 * AppSetting row: `<period>` = that period is done, `running:<period>:<ms>` =
 * a lease held by an in-flight run, taken by compare-and-set. If `fn` throws
 * (or `keepOpen` says so) the previous value is restored so a later attempt
 * retries the period. After success the done-write is retried and never
 * rethrown: `fn` has side effects (issues filed, mail sent) that a re-run would
 * repeat; if the write still fails the lease expires and a later run may repeat.
 * While `fn` runs a heartbeat renews the lease, so a slow run stays exclusive.
 *
 * Returns "locked" when another run holds a fresh lease or won the race, and
 * "done" when this period already ran (never with `force`). The two stay
 * distinct: a scheduler that treated "locked" as done would never retry if the
 * lease owner then failed.
 * @param opts setting key, period, lease length, force/keepOpen and error sink
 * @param fn the once-per-period work
 */
export async function runOncePerPeriodLocked<T>(
  opts: OncePerPeriodOptions<T>,
  fn: () => Promise<T>,
): Promise<T | "done" | "locked"> {
  const { settingKey, periodKey, now } = opts
  const prev = await prisma.appSetting.findUnique({ where: { key: settingKey } })
  if (prev && freshLease(prev.value, now, opts.leaseMs)) return "locked"
  if (prev?.value === periodKey && !opts.force) return "done"

  const lease = `${LEASE_PREFIX}${periodKey}:${now.getTime()}`
  if (!(await acquireLease(settingKey, prev?.value ?? null, lease))) return "locked"

  const heartbeat = startHeartbeat(opts, lease)
  let result: T
  try {
    result = await fn()
  } catch (e) {
    await heartbeat.stop()
    await releaseLease(opts, prev?.value ?? null, heartbeat.current())
    throw e
  }
  await heartbeat.stop()
  if (opts.keepOpen?.(result)) {
    await releaseLease(opts, prev?.value ?? null, heartbeat.current())
    return result
  }
  await markDone(opts, heartbeat.current())
  return result
}
