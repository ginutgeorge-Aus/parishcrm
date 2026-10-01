import { prisma } from "@/lib/prisma"
import { createIssue, listOpenIssuesByLabel } from "@/lib/github"
import { sydneyWeekStartYMD } from "@/lib/dates"
import { isP2002 } from "@/lib/validation"

const PROD_ERROR_LABEL = "prod-error"
const marker = (fp: string) => `<!-- fingerprint:${fp} -->`

export async function runErrorDigest(
  now: Date = new Date()
): Promise<{ filed: number; skipped: number; purged: number }> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)

  const groups = await prisma.errorLog.groupBy({
    by: ["fingerprint"],
    where: { createdAt: { gte: weekAgo } },
    _count: { _all: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  })

  const open = await listOpenIssuesByLabel(PROD_ERROR_LABEL)

  let filed = 0
  let skipped = 0
  for (const g of groups) {
    if (open.some((i) => i.body.includes(marker(g.fingerprint)))) {
      skipped++
      continue
    }
    // A representative row for human-readable context. message is already scrubbed.
    const sample = await prisma.errorLog.findFirst({
      where: { fingerprint: g.fingerprint, createdAt: { gte: weekAgo } },
      orderBy: { createdAt: "desc" },
    })
    if (!sample) continue
    const title = `prod-error: ${sample.errorType} at ${sample.route ?? "unknown"}`.slice(0, 120)
    const body = [
      marker(g.fingerprint),
      `**${g._count._all}** occurrence(s) in the last 7 days.`,
      `First: ${g._min.createdAt?.toISOString() ?? "?"}  ·  Last: ${g._max.createdAt?.toISOString() ?? "?"}`,
      `Route: \`${sample.route ?? "?"}\`  ·  Method: \`${sample.method ?? "?"}\``,
      `Type: \`${sample.errorType}\``,
      "",
      "```",
      sample.message,
      "```",
      "",
      "_Auto-filed from ErrorLog. No PII / no stacktrace._",
    ].join("\n")
    await createIssue({ title, body, labels: [PROD_ERROR_LABEL] })
    filed++
  }

  const { count: purged } = await prisma.errorLog.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } },
  })

  // Reuse this weekly run to purge the aggregate route-view counter too
  // ( Phase 3) — no separate scheduler for a bare counter table.
  await prisma.routeViewDaily.deleteMany({
    where: { date: { lt: new Date(now.getTime() - 90 * 86_400_000) } },
  })

  return { filed, skipped, purged }
}

const LAST_WEEK_KEY = "errorDigestLastWeek"
// A run that dies mid-digest (deploy, crash) leaves its lease behind; after this
// long a later run may reclaim it, so the week isn't silently lost.
const LEASE_MS = 30 * 60_000
const LEASE_PREFIX = "running:"

type DigestResult = { filed: number; skipped: number; purged: number }

function freshLease(value: string, now: Date): boolean {
  if (!value.startsWith(LEASE_PREFIX)) return false
  const startedAt = Number(value.slice(value.lastIndexOf(":") + 1))
  return Number.isFinite(startedAt) && now.getTime() - startedAt < LEASE_MS
}

/**
 * The digest skips only fingerprints with an OPEN issue, so two overlapping runs
 * (scheduler + manual trigger, a rolling deploy, a second replica) or a second
 * run in the same week would file duplicate / re-file closed issues. Guarded by
 * one AppSetting row: `<week>` = done that Sydney week, `running:<week>:<ms>` =
 * a lease held by an in-flight run. The lease is taken by compare-and-set and
 * only becomes "done" after the digest succeeds; on failure the previous value is
 * restored (best effort — if that also fails the lease just goes stale).
 *
 * Returns null when skipped (another run holds a fresh lease, or — unless
 * `force` — this week is already done).
 */
export async function runErrorDigestLocked(
  now: Date = new Date(),
  opts: { force?: boolean } = {}
): Promise<DigestResult | null> {
  const week = sydneyWeekStartYMD(now)
  const prev = await prisma.appSetting.findUnique({ where: { key: LAST_WEEK_KEY } })
  if (prev && freshLease(prev.value, now)) return null
  if (prev?.value === week && !opts.force) return null

  const lease = `${LEASE_PREFIX}${week}:${now.getTime()}`
  if (prev) {
    const { count } = await prisma.appSetting.updateMany({
      where: { key: LAST_WEEK_KEY, value: prev.value },
      data: { value: lease },
    })
    if (count === 0) return null
  } else {
    try {
      await prisma.appSetting.create({ data: { key: LAST_WEEK_KEY, value: lease } })
    } catch (e) {
      if (isP2002(e)) return null
      throw e
    }
  }

  let result: DigestResult
  try {
    result = await runErrorDigest(now)
  } catch (e) {
    // Restore what was there so a later attempt retries this week. Never let a
    // failed release mask the original error.
    const restoreTo = prev && !prev.value.startsWith(LEASE_PREFIX) ? prev.value : null
    try {
      if (restoreTo) {
        await prisma.appSetting.updateMany({ where: { key: LAST_WEEK_KEY, value: lease }, data: { value: restoreTo } })
      } else {
        await prisma.appSetting.deleteMany({ where: { key: LAST_WEEK_KEY, value: lease } })
      }
    } catch (releaseErr) {
      console.error(JSON.stringify({
        level: "error",
        source: "errorDigest",
        message: `lease release failed (expires in ${LEASE_MS / 60_000} min): ${releaseErr instanceof Error ? releaseErr.message : String(releaseErr)}`,
      }))
    }
    throw e
  }

  await prisma.appSetting.updateMany({ where: { key: LAST_WEEK_KEY, value: lease }, data: { value: week } })
  return result
}

/** In-app scheduler entry: at most once per Sydney week, never overlapping another run. */
export async function runErrorDigestOncePerWeek(now: Date = new Date()): Promise<DigestResult> {
  return (await runErrorDigestLocked(now)) ?? { filed: 0, skipped: 0, purged: 0 }
}
