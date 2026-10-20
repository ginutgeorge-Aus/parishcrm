import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { isSettingsTabVisible } from "@/components/settings/settingsTabs"
import type { FeatureKey } from "@/lib/features"

/**
 * Page-level guard for every settings tab: ADMIN only (else "/"), and the tab
 * must be visible for the enabled features (else "/settings"), so a direct
 * link to a feature-off tab never renders its form. Runs in each page because
 * the shared layout doesn't re-run on client navigation between tabs.
 * @param href the page's tab href (nested pages pass their parent tab)
 */
export async function requireSettingsTab(href: string): Promise<{ features: Set<FeatureKey> }> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")
  const features = await getEnabledFeatures()
  if (!isSettingsTabVisible(href, features)) redirect("/settings")
  return { features }
}
