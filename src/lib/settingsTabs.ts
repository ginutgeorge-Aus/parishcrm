import type { FeatureKey } from "@/lib/features"

/** Every settings tab route; a typo or rename fails to compile where it is used. */
export type SettingsTabHref =
  | "/settings"
  | "/settings/branding"
  | "/settings/email"
  | "/settings/members"
  | "/settings/receipts"
  | "/settings/features"
  | "/settings/security"
  | "/settings/audit-log"
  | "/settings/usage"
  | "/settings/about"

type SettingsTab = Readonly<{ href: SettingsTabHref; label: string }>
export type SettingsTabGroup = Readonly<{ label: string; tabs: readonly SettingsTab[] }>

/** A tab, shown only when one of `anyOf` is on (always shown when omitted). */
type TabDef = SettingsTab & Readonly<{ anyOf?: readonly FeatureKey[] }>
/** A group; `anyOf` gates every tab in it on top of each tab's own rule. */
type GroupDef = Readonly<{ label: string; anyOf?: readonly FeatureKey[]; tabs: readonly TabDef[] }>

const GROUPS: readonly GroupDef[] = [
  {
    label: "Church",
    tabs: [
      { href: "/settings", label: "General" },
      { href: "/settings/branding", label: "Branding" },
      { href: "/settings/email", label: "Email" },
      { href: "/settings/members", label: "Members", anyOf: ["welcomeLetter", "memberships"] },
      { href: "/settings/receipts", label: "Receipts", anyOf: ["receipts", "dgrReceipts"] },
      { href: "/settings/features", label: "Features" },
    ],
  },
  {
    label: "System",
    tabs: [
      { href: "/settings/security", label: "Security" },
      { href: "/settings/audit-log", label: "Audit Log" },
      { href: "/settings/usage", label: "App Usage" },
      { href: "/settings/about", label: "About" },
    ],
  },
]

/**
 * True when `anyOf` is unset or at least one of its features is on.
 * @param anyOf features of which one must be on
 * @param features enabled features
 */
function shown(anyOf: readonly FeatureKey[] | undefined, features: ReadonlySet<FeatureKey>): boolean {
  return !anyOf || anyOf.some((k) => features.has(k))
}

/**
 * Visible settings tabs, grouped, for the enabled features. Empty groups are dropped.
 * @param features enabled features (from `getEnabledFeatures()`)
 */
export function buildSettingsTabs(features: ReadonlySet<FeatureKey>): SettingsTabGroup[] {
  return GROUPS.filter((g) => shown(g.anyOf, features))
    .map((g) => ({
      label: g.label,
      tabs: g.tabs.filter((t) => shown(t.anyOf, features)).map(({ href, label }) => ({ href, label })),
    }))
    .filter((g) => g.tabs.length > 0)
}

/**
 * Whether the tab at `href` is visible for these features.
 * @param href tab href exactly as defined (e.g. "/settings/members")
 * @param features enabled features
 */
export function isSettingsTabVisible(href: SettingsTabHref, features: ReadonlySet<FeatureKey>): boolean {
  return buildSettingsTabs(features).some((g) => g.tabs.some((t) => t.href === href))
}
