"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { isAdmin } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { readRawOverrides } from "@/lib/featureFlags"
import {
  FEATURES, FEATURES_ONBOARDING_KEY, FEATURES_SETTING_KEY, type FeatureKey, type FeatureOverrides,
} from "@/lib/features"
import type { ActionResultWithSuccess } from "./types"

const DEFAULTS = new Map(FEATURES.map((f) => [f.key, f.defaultOn]))

// Strict object of every known key → boolean; rejects null, non-objects, unknown
// keys and partial maps (an omitted key would otherwise reset to its default).
const FeaturesInput = z.strictObject(
  Object.fromEntries(FEATURES.map((f) => [f.key, z.boolean()])),
)

/**
 * Save the admin's feature choices. Stores only values that differ from the
 * registry default, so future default changes still reach untouched features.
 * Also completes first-run onboarding. ADMIN only; blocked in DEMO_MODE.
 * @param input feature key → on/off, as sent by the Features form
 */
export async function saveFeatures(input: Record<string, boolean>): Promise<ActionResultWithSuccess> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Forbidden" }

  const parsed = FeaturesInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid feature settings" }
  const next: FeatureOverrides = {}
  for (const [k, v] of Object.entries(parsed.data) as [FeatureKey, boolean][]) {
    if (v !== DEFAULTS.get(k)) next[k] = v
  }
  const value = JSON.stringify(next)
  const userId = actorId(session)
  await prisma.$transaction(async (tx) => {
    const before = await readRawOverrides(tx)
    await tx.appSetting.upsert({
      where: { key: FEATURES_SETTING_KEY },
      create: { key: FEATURES_SETTING_KEY, value },
      update: { value },
    })
    await tx.appSetting.deleteMany({ where: { key: FEATURES_ONBOARDING_KEY } })
    await logAuditTx(tx, userId, "UPDATE_FEATURES", "AppSetting", undefined, {
      key: FEATURES_SETTING_KEY,
      before,
      after: next,
    })
  })
  revalidatePath("/", "layout")
  return { success: "Features saved" }
}
