import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { sendEmail, isAmbiguousDeliveryError } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { sydneyMonthKey, sydneyToday } from "@/lib/dates"
import { formatDMY } from "@/lib/formatting"
import { isP2002 } from "@/lib/validation"
import { withRetry } from "@/lib/retry"
import { UserRole } from "@/lib/generated/prisma/enums"
import { loadComplianceRows, bucketCompliance, bucketsEmpty, countFlaggedPeople } from "@/lib/clearanceCompliance"
import { renderClearanceDigestEmail } from "@/lib/clearanceDigestEmail"

/** `failed`/`sent` are per recipient; the scheduler retries while `failed > 0`. */
export type ClearanceDigestResult = { flagged: number; sent: number; failed: number }

const LAST_MONTH_KEY = "clearanceDigestLastMonth"
const LEASE_PREFIX = "running:"
// A run that dies mid-send leaves its lease behind; after this long a later run
// may reclaim it so the month is not silently lost. A digest is a handful of
// emails, so 30 minutes is far longer than a live run.
const LEASE_MS = 30 * 60_000

/** True while `value` is a lease younger than LEASE_MS (`running:<month>:<ms>`). */
function freshLease(value: string, now: Date): boolean {
  if (!value.startsWith(LEASE_PREFIX)) return false
  const startedAt = Number(value.slice(value.lastIndexOf(":") + 1))
  return Number.isFinite(startedAt) && now.getTime() - startedAt < LEASE_MS
}

/** Absolute link to the compliance page, or null when AUTH_URL is not a valid URL. */
function complianceUrl(): string | null {
  try {
    return new URL("/people/clearances", process.env.AUTH_URL ?? "http://localhost:3000").toString()
  } catch {
    return null
  }
}

/**
 * Builds and sends the digest: expired / expiring / missing / unverified
 * clearances, names only, to every active ADMIN and PASTOR. An all-clear month
 * sends nothing. Ambiguous delivery errors count as sent so a maybe-delivered
 * email is never repeated. No lease handling here; see runClearanceDigestLocked.
 */
export async function sendClearanceDigest(now: Date): Promise<ClearanceDigestResult> {
  const today = sydneyToday(now)
  const { rows, truncated } = await loadComplianceRows(today)
  if (truncated) logger.error("[clearanceDigest] more people than the compliance cap; digest covers the first batch only")
  const buckets = bucketCompliance(rows)
  if (bucketsEmpty(buckets)) return { flagged: 0, sent: 0, failed: 0 }
  const flagged = countFlaggedPeople(buckets)

  const recipients = await prisma.user.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.PASTOR] }, archivedAt: null },
    select: { email: true },
  })
  if (recipients.length === 0) {
    logger.error("[clearanceDigest] no active ADMIN or PASTOR to email; digest not sent")
    return { flagged, sent: 0, failed: 0 }
  }

  const { subject, html, text } = renderClearanceDigestEmail({
    churchName: await getChurchName(),
    asOf: formatDMY(today),
    buckets,
    complianceUrl: complianceUrl(),
  })

  let sent = 0
  let failed = 0
  for (const r of recipients) {
    try {
      await sendEmail(r.email, subject, html, text)
      sent++
    } catch (err) {
      if (isAmbiguousDeliveryError(err)) {
        sent++
        logger.error("[clearanceDigest] ambiguous delivery for one recipient; treated as sent, not retried")
      } else {
        failed++
        logger.error("[clearanceDigest] send failed for one recipient")
      }
    }
  }
  await logAudit(null, "CLEARANCE_DIGEST_SENT", "Person", undefined, {
    flagged, sent, failed,
    expired: buckets.expired.length, expiring: buckets.expiring.length,
    missing: buckets.missing.length, unverified: buckets.unverified.length,
  })
  return { flagged, sent, failed }
}

/** Puts the setting back to what it was before this run's lease (best effort, never throws). */
async function releaseLease(prevValue: string | null, lease: string): Promise<void> {
  const restoreTo = prevValue && !prevValue.startsWith(LEASE_PREFIX) ? prevValue : null
  try {
    if (restoreTo) {
      await prisma.appSetting.updateMany({ where: { key: LAST_MONTH_KEY, value: lease }, data: { value: restoreTo } })
    } else {
      await prisma.appSetting.deleteMany({ where: { key: LAST_MONTH_KEY, value: lease } })
    }
  } catch (e) {
    logger.error(`[clearanceDigest] lease release failed (expires in ${LEASE_MS / 60_000} min): ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Runs the digest at most once per Sydney month and never concurrently.
 * Guard: one AppSetting row. `<YYYY-MM>` = that month is done;
 * `running:<month>:<ms>` = a lease held by an in-flight run, taken by
 * compare-and-set. A run that fails (throws, or every send fails) restores the
 * previous value so a later attempt retries the month. Returns "locked" when
 * another run holds a fresh lease or won the race and "done" when this month
 * already ran (never with `force`); the two stay distinct so a scheduler that
 * saw "locked" is never mistaken for finished.
 */
export async function runClearanceDigestLocked(
  now: Date,
  opts: { force?: boolean } = {}
): Promise<ClearanceDigestResult | "done" | "locked"> {
  const month = sydneyMonthKey(now)
  const prev = await prisma.appSetting.findUnique({ where: { key: LAST_MONTH_KEY } })
  if (prev && freshLease(prev.value, now)) return "locked"
  if (prev?.value === month && !opts.force) return "done"

  const lease = `${LEASE_PREFIX}${month}:${now.getTime()}`
  if (prev) {
    const { count } = await prisma.appSetting.updateMany({ where: { key: LAST_MONTH_KEY, value: prev.value }, data: { value: lease } })
    if (count === 0) return "locked"
  } else {
    try {
      await prisma.appSetting.create({ data: { key: LAST_MONTH_KEY, value: lease } })
    } catch (e) {
      if (isP2002(e)) return "locked"
      throw e
    }
  }

  let result: ClearanceDigestResult
  try {
    result = await sendClearanceDigest(now)
  } catch (e) {
    await releaseLease(prev?.value ?? null, lease)
    throw e
  }
  // Every recipient failed cleanly: nothing was delivered, so release and let
  // the scheduler retry (it sees failed > 0 and keeps the month open).
  if (result.failed > 0 && result.sent === 0) {
    await releaseLease(prev?.value ?? null, lease)
    return result
  }
  // Mail is out: never rethrow from here (a retry would re-send). Retry the
  // write; if it still fails the lease expires and a later run may repeat.
  try {
    await withRetry(
      () => prisma.appSetting.updateMany({ where: { key: LAST_MONTH_KEY, value: lease }, data: { value: month } }),
      { attempts: 3, baseDelayMs: 200 }
    )
  } catch (e) {
    logger.error(`[clearanceDigest] digest sent but failed to mark ${month} done: ${e instanceof Error ? e.message : String(e)}`)
  }
  return result
}

/** In-app scheduler entry: once per Sydney month, never overlapping another run. Throws when locked so success is not recorded. */
export async function runClearanceDigest(now: Date = new Date()): Promise<ClearanceDigestResult> {
  const r = await runClearanceDigestLocked(now)
  if (r === "done") return { flagged: 0, sent: 0, failed: 0 }
  if (r === "locked") throw new Error("another clearance-digest run is in progress — will retry")
  return r
}
