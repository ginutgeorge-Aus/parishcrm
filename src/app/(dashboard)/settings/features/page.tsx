import { requireSettingsTab } from "@/lib/settingsAccess"
import { readRawOverrides } from "@/lib/featureFlags"
import { FeaturesForm } from "@/components/settings/FeaturesForm"
import { prisma } from "@/lib/prisma"
import { isDemoMode } from "@/lib/demoMode"
import { FEATURES_ONBOARDING_KEY } from "@/lib/features"

export const dynamic = "force-dynamic"

/**
 * Settings → Features: ADMIN picks which features this church uses. The
 * first-run welcome state comes from the pending flag in the DB (not the
 * `?welcome=1` URL), so a reload or the sidebar link still shows it.
 */
export default async function FeaturesPage() {
  const [{ data: initial }, flag] = await Promise.all([
    requireSettingsTab("/settings/features", readRawOverrides),
    isDemoMode() ? null : prisma.appSetting.findUnique({ where: { key: FEATURES_ONBOARDING_KEY } }),
  ])
  return <FeaturesForm initial={initial} welcome={flag?.value === "pending"} />
}
