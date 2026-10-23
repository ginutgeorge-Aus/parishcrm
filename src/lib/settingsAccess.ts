import { redirect } from "next/navigation"
import { getSession } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { isSettingsTabVisible, type SettingsTabHref } from "@/lib/settingsTabs"
import type { FeatureKey } from "@/lib/features"

/** Per-request session (the app-wide cached getter), so the dashboard layout, settings layout and tab page decode the JWT once. */
export const getSettingsSession = getSession

/** Result of {@link requireSettingsTab}; `data` is `null` when no `load` was passed. */
export type SettingsTabAccess<T> = { features: Set<FeatureKey>; data: T }

/**
 * Page-level guard for every settings tab: ADMIN only (else "/"), and the tab
 * must be visible for the enabled features (else "/settings"), so a direct
 * link to a feature-off tab never renders its form. Runs in each page because
 * the shared layout doesn't re-run on client navigation between tabs.
 * `load` (the page's feature-independent reads) starts once the role check
 * passes and runs alongside the feature read; a hidden tab still redirects
 * before its result (or error) is used. Without `load`, `data` is `null`.
 * @param href the page's tab href (nested pages pass their parent tab)
 * @param load optional page data read, run in parallel with the feature read
 */
export async function requireSettingsTab(href: SettingsTabHref): Promise<SettingsTabAccess<null>>
export async function requireSettingsTab<T>(
  href: SettingsTabHref,
  load: () => Promise<T>,
): Promise<SettingsTabAccess<T>>
export async function requireSettingsTab<T>(
  href: SettingsTabHref,
  load?: () => Promise<T>,
): Promise<SettingsTabAccess<T | null>> {
  const session = await getSettingsSession()
  if (!isAdmin(session?.user?.role)) redirect("/")
  // Deferred via a promise so a synchronous throw from `load` is also held until after the redirect check.
  const pending = load ? Promise.resolve().then(() => load()) : undefined
  // Redirect wins over a load error; the rejection is re-raised below if the tab is visible.
  pending?.catch(() => {})
  const features = await getEnabledFeatures()
  if (!isSettingsTabVisible(href, features)) redirect("/settings")
  return { features, data: pending ? await pending : null }
}
