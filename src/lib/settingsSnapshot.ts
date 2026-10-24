import { FEATURES_SETTING_KEY } from "@/lib/features"

/** AppSetting key of the site-wide maintenance flag. */
export const MAINTENANCE_SETTING_KEY = "maintenance"

/** Stored value per setting key (null when the row is absent). */
export type SettingsSnapshot = Readonly<Record<string, string | null>>

const KEYS = [MAINTENANCE_SETTING_KEY, FEATURES_SETTING_KEY] as const
/** How long a successful read is served before the next one. */
const SNAPSHOT_TTL_MS = 5_000
/** How long a failed read is replayed, so a DB outage is not re-queried by every request. */
const FAILURE_TTL_MS = 2_000

/** Per-process cache state, kept in one object so invalidation resets it in one place. */
const state: {
  cache: { snap: SettingsSnapshot; at: number } | null
  failure: { err: unknown; at: number } | null
  inflight: Promise<SettingsSnapshot> | null
  /** Bumped by invalidation so a read that started before it cannot repopulate the cache with stale data. */
  generation: number
} = { cache: null, failure: null, inflight: null, generation: 0 }

/** One query for every setting the middleware needs; throws on any failure (logged once, cached briefly). */
async function load(): Promise<SettingsSnapshot> {
  const gen = state.generation
  try {
    return await query(gen)
  } catch (err) {
    // Error class only: driver messages can echo query values.
    console.error("[settingsSnapshot] settings read failed", err instanceof Error ? err.name : "UnknownError")
    if (gen === state.generation) state.failure = { err, at: Date.now() }
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
  if (gen === state.generation) {
    state.cache = { snap, at: Date.now() }
    state.failure = null
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
  if (state.cache && Date.now() - state.cache.at < SNAPSHOT_TTL_MS) return state.cache.snap
  if (state.failure && Date.now() - state.failure.at < FAILURE_TTL_MS) throw state.failure.err
  if (!state.inflight) {
    const read: Promise<SettingsSnapshot> = load().finally(() => {
      if (state.inflight === read) state.inflight = null
    })
    state.inflight = read
  }
  return state.inflight
}

/** Current invalidation generation; callers compare before/after a read to detect a concurrent invalidation. */
export function settingsGeneration(): number {
  return state.generation
}

/**
 * Drop the cached snapshot and failure so the next call re-reads (a read already
 * in flight is discarded). Clearing the failure cache is deliberate: a save only
 * succeeds when the DB is up, so the next read should retry at once instead of
 * replaying a stale failure. (A save during an outage fails, so it never gets here.) The snapshot is shared, so this refreshes BOTH the
 * maintenance flag and the feature flags.
 */
export function invalidateSettingsSnapshot(): void {
  state.generation++
  state.cache = null
  state.failure = null
  state.inflight = null
}
