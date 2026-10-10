import { prisma } from "@/lib/prisma"
import { isP2002 } from "@/lib/validation"
import { withRetry } from "@/lib/retry"

const LEASE_PREFIX = "running:"

export type OncePerPeriodOptions<T> = {
  /** AppSetting key holding the done-period marker or the lease. */
  settingKey: string
  /** The period this run covers, e.g. a Sydney week start or `YYYY-MM`. */
  periodKey: string
  /** How long a lease counts as held; an older one may be reclaimed. */
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
 * Runs `fn` at most once per period and never concurrently, guarded by one
 * AppSetting row: `<period>` = that period is done, `running:<period>:<ms>` =
 * a lease held by an in-flight run, taken by compare-and-set. If `fn` throws
 * (or `keepOpen` says so) the previous value is restored so a later attempt
 * retries the period. After success the done-write is retried and never
 * rethrown: `fn` has side effects (issues filed, mail sent) that a re-run would
 * repeat; if the write still fails the lease expires and a later run may repeat.
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
  if (prev) {
    const { count } = await prisma.appSetting.updateMany({ where: { key: settingKey, value: prev.value }, data: { value: lease } })
    if (count === 0) return "locked"
  } else {
    try {
      await prisma.appSetting.create({ data: { key: settingKey, value: lease } })
    } catch (e) {
      if (isP2002(e)) return "locked"
      throw e
    }
  }

  let result: T
  try {
    result = await fn()
  } catch (e) {
    await releaseLease(opts, prev?.value ?? null, lease)
    throw e
  }
  if (opts.keepOpen?.(result)) {
    await releaseLease(opts, prev?.value ?? null, lease)
    return result
  }
  try {
    await withRetry(
      () => prisma.appSetting.updateMany({ where: { key: settingKey, value: lease }, data: { value: periodKey } }),
      { attempts: 3, baseDelayMs: 200 },
    )
  } catch (e) {
    opts.logError(`ran but failed to mark ${periodKey} done: ${e instanceof Error ? e.message : String(e)}`)
  }
  return result
}
