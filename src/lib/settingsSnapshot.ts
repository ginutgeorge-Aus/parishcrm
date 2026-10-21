import { FEATURES_SETTING_KEY } from "@/lib/features"

/** AppSetting key of the site-wide maintenance flag (re-exported by `maintenance.ts`). */
export const MAINTENANCE_SETTING_KEY = "maintenance"

/** Stored value per setting key (null when the row is absent). */
export type SettingsSnapshot = Readonly<Record<string, string | null>>

const KEYS = [MAINTENANCE_SETTING_KEY, FEATURES_SETTING_KEY] as const
const TTL_MS = 5_000

let cache: { snap: SettingsSnapshot; at: number } | null = null
let inflight: Promise<SettingsSnapshot> | null = null
// Bumped by invalidation so a read that started before it cannot repopulate the cache with stale data.
let generation = 0

/** One query for every setting the middleware needs; throws on any failure. */
async function load(): Promise<SettingsSnapshot> {
  const gen = generation
  // Deferred import: @/lib/prisma is `server-only`, so a top-level import makes
  // this module (and maintenance.ts) unloadable from scripts/set-maintenance.ts.
  const { prisma } = await import("@/lib/prisma")
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...KEYS] } } })
  const snap: Record<string, string | null> = Object.fromEntries(KEYS.map((k) => [k, null]))
  for (const r of rows) snap[r.key] = r.value
  if (gen === generation) cache = { snap, at: Date.now() }
  return snap
}

/**
 * Middleware settings (maintenance + features), cached 5s per process. One
 * query serves both, and concurrent callers share one read. Failures are NOT
 * cached or swallowed here: each caller applies its own fail-open policy.
 * @throws when the database read fails
 */
export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.snap
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

/** Drop the cached snapshot so the next call re-reads (a read already in flight is discarded). */
export function invalidateSettingsSnapshot(): void {
  generation++
  cache = null
  inflight = null
}
