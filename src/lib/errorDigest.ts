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

/**
 * In-app scheduler entry: the digest skips only fingerprints with an OPEN issue,
 * so a second run in the same week (e.g. after a deploy restarts the process)
 * would re-file issues closed since Monday. The Sydney week of the last
 * run is claimed atomically and persisted so restarts can't repeat it; the manual
 * /api/cron/error-issues trigger still calls runErrorDigest directly.
 */
export async function runErrorDigestOncePerWeek(
  now: Date = new Date()
): Promise<{ filed: number; skipped: number; purged: number }> {
  const week = sydneyWeekStartYMD(now)
  const none = { filed: 0, skipped: 0, purged: 0 }
  const prev = await prisma.appSetting.findUnique({ where: { key: LAST_WEEK_KEY } })
  if (prev?.value === week) return none

  // Atomic claim (compare-and-set on the value we read) so two processes — a
  // rolling deploy's overlap, a second replica — can't both file issues.
  if (prev) {
    const { count } = await prisma.appSetting.updateMany({
      where: { key: LAST_WEEK_KEY, value: prev.value },
      data: { value: week },
    })
    if (count === 0) return none
  } else {
    try {
      await prisma.appSetting.create({ data: { key: LAST_WEEK_KEY, value: week } })
    } catch (e) {
      if (isP2002(e)) return none
      throw e
    }
  }

  try {
    return await runErrorDigest(now)
  } catch (e) {
    // Release the claim so a later tick retries this week.
    if (prev) await prisma.appSetting.update({ where: { key: LAST_WEEK_KEY }, data: { value: prev.value } })
    else await prisma.appSetting.delete({ where: { key: LAST_WEEK_KEY } })
    throw e
  }
}
