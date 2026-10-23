import { buildSettingsTabs, isSettingsTabVisible, type SettingsTabHref } from "@/lib/settingsTabs"
import type { FeatureKey } from "@/lib/features"

const on = (...keys: FeatureKey[]) => new Set<FeatureKey>(keys)
const hrefs = (features: Set<FeatureKey>) => buildSettingsTabs(features).flatMap((g) => g.tabs.map((t) => t.href))

describe("buildSettingsTabs", () => {
  it("lists groups in order: Church, System", () => {
    expect(buildSettingsTabs(on()).map((g) => g.label)).toEqual(["Church", "System"])
  })

  it("shows the always-on tabs with no features", () => {
    expect(hrefs(on())).toEqual([
      "/settings", "/settings/branding", "/settings/email", "/settings/features",
      "/settings/security", "/settings/audit-log", "/settings/usage", "/settings/about",
    ])
  })

  it.each<[FeatureKey]>([["welcomeLetter"], ["memberships"]])("shows Members when %s is on", (k) => {
    expect(hrefs(on(k))).toContain("/settings/members")
  })

  it.each<[FeatureKey]>([["receipts"], ["dgrReceipts"]])("shows Receipts when %s is on", (k) => {
    expect(hrefs(on(k))).toContain("/settings/receipts")
  })

  it("hides Members and Receipts when their features are off", () => {
    expect(hrefs(on("events"))).not.toContain("/settings/members")
    expect(hrefs(on("events"))).not.toContain("/settings/receipts")
  })
})

describe("isSettingsTabVisible", () => {
  it("is false for a feature-off tab and for unknown hrefs", () => {
    expect(isSettingsTabVisible("/settings/members", on())).toBe(false)
    expect(isSettingsTabVisible("/settings/nope" as SettingsTabHref, on())).toBe(false)
  })
  it("is true for a shown tab", () => {
    expect(isSettingsTabVisible("/settings/members", on("memberships"))).toBe(true)
  })
})
