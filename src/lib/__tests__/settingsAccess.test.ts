jest.mock("next/navigation", () => ({ redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }) }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ getEnabledFeatures: jest.fn() }))

import { auth } from "@/auth"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { requireSettingsTab } from "@/lib/settingsAccess"

const mockAuth = auth as unknown as jest.Mock
const mockFeatures = getEnabledFeatures as jest.Mock

beforeEach(() => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  mockFeatures.mockResolvedValue(new Set())
})

it.each(["PASTOR", "OFFICE_ADMIN", "VIEWER", undefined])("redirects role %s to /", async (role) => {
  mockAuth.mockResolvedValue(role ? { user: { role } } : null)
  await expect(requireSettingsTab("/settings")).rejects.toThrow(/^NEXT_REDIRECT \/$/)
})

it("redirects a feature-off tab to /settings", async () => {
  await expect(requireSettingsTab("/settings/members")).rejects.toThrow("NEXT_REDIRECT /settings")
})

it("returns the features for a visible tab", async () => {
  mockFeatures.mockResolvedValue(new Set(["memberships"]))
  await expect(requireSettingsTab("/settings/members")).resolves.toEqual({ features: new Set(["memberships"]) })
})
