import "server-only"
import { cache } from "react"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
import {
  FEATURES_SETTING_KEY, FEATURE_OFF_MESSAGE, parseOverrides, resolveFeatures,
  type FeatureKey, type FeatureOverrides,
} from "@/lib/features"

/** Result a gated job/cron returns instead of running while its feature is off. */
export const FEATURE_OFF_SKIP = { skipped: "feature off" } as const
export type FeatureOffSkip = typeof FEATURE_OFF_SKIP

/**
 * Stored overrides only (no defaults applied). Used by the Features page and
 * saveFeatures (inside its transaction).
 * @param db Prisma client or interactive-transaction client
 */
export async function readRawOverrides(
  db: Pick<Prisma.TransactionClient, "appSetting"> = prisma,
): Promise<FeatureOverrides> {
  const row = await db.appSetting.findUnique({ where: { key: FEATURES_SETTING_KEY } })
  const overrides = parseOverrides(row?.value)
  if (row?.value && Object.keys(overrides).length === 0 && row.value.trim() !== "{}") {
    console.warn("[features] unreadable 'features' setting — using defaults")
  }
  return overrides
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

/** Server Action guard: `{ error }` when off, else null. Call first, before auth/DB work. */
export async function featureGuard(key: FeatureKey): Promise<{ error: string } | null> {
  return (await isFeatureOn(key)) ? null : { error: FEATURE_OFF_MESSAGE }
}

/** Scheduler/cron wrapper: runs fn only when the feature is on. */
export async function skipIfFeatureOff<T>(key: FeatureKey, fn: () => Promise<T>): Promise<T | FeatureOffSkip> {
  return (await isFeatureOn(key)) ? fn() : FEATURE_OFF_SKIP
}
