import { prisma } from "@/lib/prisma"

const RETENTION_DAYS = 90

/**
 * Cutoff instant: rows older than this are purged.
 * @param now - Reference instant.
 * @returns `now` minus the 90-day retention window.
 */
function cutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * 86_400_000)
}

/**
 * Delete ErrorLog rows older than 90 days.
 * @param now - Reference instant.
 * @returns Number of rows deleted.
 */
export async function purgeErrorLog(now: Date): Promise<number> {
  const { count } = await prisma.errorLog.deleteMany({ where: { createdAt: { lt: cutoff(now) } } })
  return count
}

/**
 * Delete aggregate route-view counter rows older than 90 days.
 * @param now - Reference instant.
 * @returns Number of rows deleted.
 */
export async function purgeRouteViews(now: Date): Promise<number> {
  const { count } = await prisma.routeViewDaily.deleteMany({ where: { date: { lt: cutoff(now) } } })
  return count
}

/**
 * Always-on daily retention job (AUD-6-06): purges both telemetry tables whether or not the optional weekly error
 * digest is configured. Each purge is independent; the first failure is rethrown after both have run, so the
 * scheduler retries the day.
 * @param now - Reference instant.
 * @returns Rows deleted per table.
 */
export async function runTelemetryPurge(now: Date = new Date()): Promise<{ errorLogs: number; routeViews: number }> {
  let errorLogs = 0
  let routeViews = 0
  let failure: unknown = null
  try { errorLogs = await purgeErrorLog(now) } catch (e) { failure = e }
  try { routeViews = await purgeRouteViews(now) } catch (e) { failure ??= e }
  if (failure) throw failure
  return { errorLogs, routeViews }
}
