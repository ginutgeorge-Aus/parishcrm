import { cache } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { isSettingsTabVisible, type SettingsTabHref } from "@/components/settings/settingsTabs"
import type { FeatureKey } from "@/lib/features"

/** Per-request session, so the settings layout and the tab page decode the JWT once. */
export const getSettingsSession = cache(() => auth())

/**
 * Page-level guard for every settings tab: ADMIN only (else "/"), and the tab
 * must be visible for the enabled features (else "/settings"), so a direct
 * link to a feature-off tab never renders its form. Runs in each page because
 * the shared layout doesn't re-run on client navigation between tabs.
 * `load` (the page's feature-independent reads) starts once the role check
 * passes and runs alongside the feature read; a hidden tab still redirects
 * before its result (or error) is used.
 * @param href the page's tab href (nested pages pass their parent tab)
 * @param load optional page data read, run in parallel with the feature read
 */
export async function requireSettingsTab<T = undefined>(
  href: SettingsTabHref,
  load?: () => Promise<T>,
): Promise<{ features: Set<FeatureKey>; data: T }> {
  const session = await getSettingsSession()
  if (!isAdmin(session?.user?.role)) redirect("/")
  const pending = load?.()
  // Redirect wins over a load error; the rejection is re-raised below if the tab is visible.
  pending?.catch(() => {})
  const features = await getEnabledFeatures()
  if (!isSettingsTabVisible(href, features)) redirect("/settings")
  return { features, data: (await pending) as T }
}
