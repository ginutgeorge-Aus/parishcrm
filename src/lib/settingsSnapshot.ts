import { FEATURES_SETTING_KEY } from "@/lib/features"

/** AppSetting key of the site-wide maintenance flag. */
export const MAINTENANCE_SETTING_KEY = "maintenance"

/** Stored value per setting key (null when the row is absent). */
export type SettingsSnapshot = Readonly<Record<string, string | null>>

const KEYS = [MAINTENANCE_SETTING_KEY, FEATURES_SETTING_KEY] as const
const TTL_MS = 5_000
// A failed read is cached briefly so a DB outage is not re-queried by every request.
const FAILURE_TTL_MS = 2_000

let cache: { snap: SettingsSnapshot; at: number } | null = null
let failure: { err: unknown; at: number } | null = null
let inflight: Promise<SettingsSnapshot> | null = null
// Bumped by invalidation so a read that started before it cannot repopulate the cache with stale data.
let generation = 0

/** One query for every setting the middleware needs; throws on any failure (logged once, cached briefly). */
async function load(): Promise<SettingsSnapshot> {
  const gen = generation
  try {
    return await query(gen)
  } catch (err) {
    // Error class only: driver messages can echo query values.
    console.error("[settingsSnapshot] settings read failed", err instanceof Error ? err.name : "UnknownError")
    if (gen === generation) failure = { err, at: Date.now() }
    throw err
  }
}

/**
 * The DB read behind `load`.
 * @param gen generation the read started in; a stale read never populates the cache
 */
async function query(gen: number): Promise<SettingsSnapshot> {
  // Deferred import: @/lib/prisma is `server-only`, so a top-level import makes
  // this module (and maintenance.ts) unloadable from scripts/set-maintenance.ts.
  const { prisma } = await import("@/lib/prisma")
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...KEYS] } } })
  const snap: Record<string, string | null> = Object.fromEntries(KEYS.map((k) => [k, null]))
  for (const r of rows) snap[r.key] = r.value
  if (gen === generation) {
    cache = { snap, at: Date.now() }
    failure = null
  }
  return snap
}

/**
 * Middleware settings (maintenance + features), cached 5s per process. One
 * query serves both, and concurrent callers share one read. Failures are NOT
 * swallowed here (each caller applies its own fail-open policy), but one is
 * cached for a short TTL and rethrown, so an outage costs one query per window.
 * @throws when the database read fails
 */
export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.snap
  if (failure && Date.now() - failure.at < FAILURE_TTL_MS) throw failure.err
  if (!inflight) {
    const read: Promise<SettingsSnapshot> = load().finally(() => {
      if (inflight === read) inflight = null
    })
    inflight = read
  }
  return inflight
}

/** Current invalidation generation; callers compare before/after a read to detect a concurrent invalidation. */
export function settingsGeneration(): number {
  return generation
}

/**
 * Drop the cached snapshot and failure so the next call re-reads (a read already
 * in flight is discarded). The snapshot is shared, so this refreshes BOTH the
 * maintenance flag and the feature flags.
 */
export function invalidateSettingsSnapshot(): void {
  generation++
  cache = null
  failure = null
  inflight = null
}
