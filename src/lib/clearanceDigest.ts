import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { sendEmail, isAmbiguousDeliveryError } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { sydneyMonthKey, sydneyToday } from "@/lib/dates"
import { formatDMY } from "@/lib/formatting"
import { runOncePerPeriodLocked } from "@/lib/periodLease"
import { UserRole } from "@/lib/generated/prisma/enums"
import { loadComplianceRows, bucketCompliance, bucketsEmpty, countFlaggedPeople } from "@/lib/clearanceCompliance"
import { renderClearanceDigestEmail } from "@/lib/clearanceDigestEmail"

/** `failed`/`sent` are per recipient; the scheduler retries while `failed > 0`. */
export type ClearanceDigestResult = { flagged: number; sent: number; failed: number }

const LAST_MONTH_KEY = "clearanceDigestLastMonth"
const DELIVERED_KEY = "clearanceDigestDelivered"
// A run that dies mid-send leaves its lease behind; after this long a later run
// may reclaim it so the month is not silently lost. A digest is a handful of
// emails, so 30 minutes is far longer than a live run.
const LEASE_MS = 30 * 60_000

/** Absolute link to the compliance page, or null when AUTH_URL is not a valid URL. */
function complianceUrl(): string | null {
  try {
    return new URL("/people/clearances", process.env.AUTH_URL ?? "http://localhost:3000").toString()
  } catch {
    return null
  }
}

/** Lowercased, trimmed email, so the delivered list matches regardless of case. */
function normEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Emails already sent this Sydney `month` (empty for another month, a missing row or bad JSON). */
async function loadDelivered(month: string): Promise<Set<string>> {
  const row = await prisma.appSetting.findUnique({ where: { key: DELIVERED_KEY } })
  if (!row) return new Set()
  try {
    const parsed = JSON.parse(row.value) as { month?: unknown; emails?: unknown }
    if (parsed.month !== month || !Array.isArray(parsed.emails)) return new Set()
    return new Set(parsed.emails.filter((e): e is string => typeof e === "string").map(normEmail))
  } catch {
    return new Set()
  }
}

/** Saves the delivered list for `month`; false when the write failed. Never throws, because mail is already out. */
async function saveDelivered(month: string, emails: Set<string>): Promise<boolean> {
  const value = JSON.stringify({ month, emails: [...emails] })
  try {
    await prisma.appSetting.upsert({ where: { key: DELIVERED_KEY }, create: { key: DELIVERED_KEY, value }, update: { value } })
    return true
  } catch (e) {
    logger.error(`[clearanceDigest] could not save the delivered list: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

/**
 * Builds and sends the digest: expired / expiring / missing / unverified
 * clearances, names only, to every active ADMIN and PASTOR who has not already
 * got this Sydney month's digest. Delivered addresses are kept per month in an
 * app setting (email addresses only), so a retry after a partial failure sends
 * only to the rest. `force` ignores that list and replaces it with this run's
 * deliveries. An all-clear month sends nothing. Ambiguous delivery errors count
 * as delivered so a maybe-delivered email is never repeated; likewise, if the
 * list could not be saved, failures are not reported for retry (a retry could
 * not tell who already has it). Addresses differing only in case or spaces get
 * one email, sent to the trimmed address. `sent`/`failed` count this run only.
 * No lease handling here; see runClearanceDigestLocked.
 */
export async function sendClearanceDigest(now: Date, opts: { force?: boolean } = {}): Promise<ClearanceDigestResult> {
  const today = sydneyToday(now)
  const month = sydneyMonthKey(now)
  const { rows } = await loadComplianceRows(today)
  const buckets = bucketCompliance(rows)
  if (bucketsEmpty(buckets)) return { flagged: 0, sent: 0, failed: 0 }
  const flagged = countFlaggedPeople(buckets)

  const users = await prisma.user.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.PASTOR] }, archivedAt: null },
    select: { email: true },
  })
  // One entry per mailbox: the trimmed address is what we send to, the normalised one is the tracking key.
  const recipients = [...new Map(users.map((u) => [normEmail(u.email), { to: u.email.trim(), key: normEmail(u.email) }])).values()]
  if (recipients.length === 0) {
    logger.error("[clearanceDigest] no active ADMIN or PASTOR to email; digest not sent")
    return { flagged, sent: 0, failed: 0 }
  }

  const delivered = opts.force ? new Set<string>() : await loadDelivered(month)
  const pending = recipients.filter((r) => !delivered.has(r.key))
  if (pending.length === 0) return { flagged, sent: 0, failed: 0 }

  const { subject, html, text } = renderClearanceDigestEmail({
    churchName: await getChurchName(),
    asOf: formatDMY(today),
    buckets,
    complianceUrl: complianceUrl(),
  })

  let sent = 0
  let failed = 0
  let saved = true
  // Sequential on purpose: each send is recorded before the next, so a retry only mails addresses not yet recorded.
  for (const r of pending) {
    try {
      await sendEmail(r.to, subject, html, text) // NOSONAR S9382
      sent++
    } catch (err) {
      if (isAmbiguousDeliveryError(err)) {
        sent++
        logger.error("[clearanceDigest] ambiguous delivery for one recipient; treated as sent, not retried")
      } else {
        failed++
        logger.error("[clearanceDigest] send failed for one recipient")
        continue
      }
    }
    delivered.add(r.key)
    // Only the latest write matters: each one stores the whole set, so a later success repairs an earlier failure.
    saved = await saveDelivered(month, delivered) // NOSONAR S9382
  }
  await logAudit(null, "CLEARANCE_DIGEST_SENT", "Person", undefined, {
    flagged, sent, failed,
    expired: buckets.expired.length, expiring: buckets.expiring.length,
    missing: buckets.missing.length, unverified: buckets.unverified.length,
  })
  if (failed > 0 && !saved) {
    logger.error("[clearanceDigest] delivered list not saved; not retrying the failed sends, to avoid repeats")
    return { flagged, sent, failed: 0 }
  }
  return { flagged, sent, failed }
}

/**
 * Runs the digest at most once per Sydney month and never concurrently, via
 * runOncePerPeriodLocked (see there for the lease and the "done" vs "locked"
 * contract). A run where any send failed keeps the month open so a later
 * attempt retries; delivered recipients are tracked separately (see
 * sendClearanceDigest), so that retry only emails the ones still missing.
 * @param now run time; picks the Sydney month
 * @param opts `force` resends to everyone, even for a month already done
 */
export async function runClearanceDigestLocked(
  now: Date,
  opts: { force?: boolean } = {}
): Promise<ClearanceDigestResult | "done" | "locked"> {
  return runOncePerPeriodLocked(
    {
      settingKey: LAST_MONTH_KEY,
      periodKey: sydneyMonthKey(now),
      leaseMs: LEASE_MS,
      now,
      force: opts.force,
      keepOpen: (r) => r.failed > 0,
      logError: (message) => logger.error(`[clearanceDigest] ${message}`),
    },
    () => sendClearanceDigest(now, { force: opts.force }),
  )
}

/** In-app scheduler entry: once per Sydney month, never overlapping another run. Throws when locked so success is not recorded. */
export async function runClearanceDigest(now: Date = new Date()): Promise<ClearanceDigestResult> {
  const r = await runClearanceDigestLocked(now)
  if (r === "done") return { flagged: 0, sent: 0, failed: 0 }
  if (r === "locked") throw new Error("another clearance-digest run is in progress — will retry")
  return r
}
