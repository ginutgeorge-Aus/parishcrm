import "server-only"
import { cache } from "react"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { bearerOk } from "@/lib/cronAuth"
import type { Prisma } from "@/lib/generated/prisma/client"
import {
  FEATURES_SETTING_KEY, FEATURE_OFF_MESSAGE, FEATURE_OFF_SKIP, type FeatureOffSkip, parseStoredOverrides, resolveFeatures,
  type FeatureKey, type FeatureOverrides,
} from "@/lib/features"


/**
 * Stored overrides only (no defaults applied). Used by the Features page and
 * saveFeatures (inside its transaction).
 * @param db Prisma client or interactive-transaction client
 */
export async function readRawOverrides(
  db: Pick<Prisma.TransactionClient, "appSetting"> = prisma,
): Promise<FeatureOverrides> {
  const row = await db.appSetting.findUnique({ where: { key: FEATURES_SETTING_KEY } })
  return parseStoredOverrides(row?.value)
}

/** Enabled feature set, read once per request. */
export const getEnabledFeatures = cache(async (): Promise<Set<FeatureKey>> =>
  resolveFeatures(await readRawOverrides()))

/** True when `key` is on. */
export async function isFeatureOn(key: FeatureKey): Promise<boolean> {
  return (await getEnabledFeatures()).has(key)
}

/** Page/layout guard: 404 when the feature is off. */
export async function requireFeature(key: FeatureKey): Promise<void> {
  if (!(await isFeatureOn(key))) notFound()
}

/**
 * Server Action guard: `{ error }` when off, else null. Order: assertNotDemo →
 * auth + DB-free role check → this → any per-entity DB authz (e.g.
 * canManageEvent), so anonymous or wrong-role callers never trigger the
 * settings read or see the admin wording. Public actions: throttle → this.
 */
export async function featureGuard(key: FeatureKey): Promise<{ error: string } | null> {
  return (await isFeatureOn(key)) ? null : { error: FEATURE_OFF_MESSAGE }
}

/**
 * Server Action guard for something shared by several features (e.g. receipt
 * settings, used by giving receipts and DGR receipts): `{ error }` only when
 * every one of `keys` is off.
 */
export async function featureGuardAny(keys: FeatureKey[]): Promise<{ error: string } | null> {
  const on = await getEnabledFeatures()
  return keys.some((k) => on.has(k)) ? null : { error: FEATURE_OFF_MESSAGE }
}

/**
 * Throwing guard for exported actions whose result has no `{ error }` shape
 * (page-load readers, internal validators). Pages reach them only through a
 * segment already gated by requireFeature, so this is defence in depth.
 */
export async function assertFeature(key: FeatureKey): Promise<void> {
  if (!(await isFeatureOn(key))) throw new Error(FEATURE_OFF_MESSAGE)
}

/**
 * API route guard: a JSON 404 `{ error: "Not found" }` while the feature is
 * off, else null. JSON so public forms that parse the body before checking
 * `res.ok` show a real message. Public routes call it after their rate limit,
 * so throttled requests never reach the database; authed routes call it after
 * their auth + role check, so feature state never leaks pre-auth.
 */
export async function featureNotFound(key: FeatureKey): Promise<Response | null> {
  return (await isFeatureOn(key)) ? null : Response.json({ error: "Not found" }, { status: 404 })
}

/**
 * Cron route guard: a 200 `{ skipped: "feature off" }` (so an external cron
 * doesn't alert) while the feature is off — but only for a caller holding the
 * cron secret. Anyone else gets null and falls through to the route's own
 * 401/503, so feature state isn't revealed to unauthenticated callers.
 * @param authorization the request's Authorization header
 */
export async function cronFeatureSkip(authorization: string | null, key: FeatureKey): Promise<Response | null> {
  const secret = process.env.CRON_SECRET
  if (!secret || !bearerOk(authorization, secret)) return null
  return (await isFeatureOn(key)) ? null : Response.json(FEATURE_OFF_SKIP)
}

/** Scheduler/cron wrapper: runs fn only when the feature is on. */
export async function skipIfFeatureOff<T>(key: FeatureKey, fn: () => Promise<T>): Promise<T | FeatureOffSkip> {
  return (await isFeatureOn(key)) ? fn() : FEATURE_OFF_SKIP
}
