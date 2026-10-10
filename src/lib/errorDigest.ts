import { prisma } from "@/lib/prisma"
import { createIssue, listOpenIssuesByLabel } from "@/lib/github"
import { sydneyWeekStartYMD } from "@/lib/dates"
import { runOncePerPeriodLocked } from "@/lib/periodLease"

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
// long a later run may reclaim it, so the week isn't silently lost. Generous so a
// long digest (many fingerprints filed one by one) is never treated as abandoned
// and overlapped; a weekly job can afford a 2 h recovery delay.
const LEASE_MS = 2 * 60 * 60_000

type DigestResult = { filed: number; skipped: number; purged: number }

/**
 * The digest skips only fingerprints with an OPEN issue, so two overlapping runs
 * (scheduler + manual trigger, a rolling deploy, a second replica) or a second
 * run in the same week would file duplicate / re-file closed issues. Runs at
 * most once per Sydney week via runOncePerPeriodLocked (see there for the lease
 * and the "done" vs "locked" contract).
 * @param now run time; picks the Sydney week
 * @param opts `force` re-runs a week already done
 */
export async function runErrorDigestLocked(
  now: Date = new Date(),
  opts: { force?: boolean } = {}
): Promise<DigestResult | "done" | "locked"> {
  return runOncePerPeriodLocked(
    {
      settingKey: LAST_WEEK_KEY,
      periodKey: sydneyWeekStartYMD(now),
      leaseMs: LEASE_MS,
      now,
      force: opts.force,
      // console.error, not logger.error: logger persists to ErrorLog, which this digest reads.
      logError: (message) => console.error(JSON.stringify({ level: "error", source: "errorDigest", message })),
    },
    () => runErrorDigest(now),
  )
}

/** In-app scheduler entry: at most once per Sydney week, never overlapping another run. */
export async function runErrorDigestOncePerWeek(now: Date = new Date()): Promise<DigestResult> {
  const r = await runErrorDigestLocked(now)
  if (r === "done") return { filed: 0, skipped: 0, purged: 0 }
  // Throw (not a zero result) so the scheduler doesn't record this week as done.
  if (r === "locked") throw new Error("another error-digest run is in progress — will retry")
  return r
}
