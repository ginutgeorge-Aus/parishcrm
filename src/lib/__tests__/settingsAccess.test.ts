/** @jest-environment node */
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

it.each(["PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER", undefined])("redirects role %s to /", async (role) => {
  mockAuth.mockResolvedValue(role ? { user: { role } } : null)
  await expect(requireSettingsTab("/settings")).rejects.toThrow(/^NEXT_REDIRECT \/$/)
})

it("redirects a feature-off tab to /settings", async () => {
  await expect(requireSettingsTab("/settings/members")).rejects.toThrow(/^NEXT_REDIRECT \/settings$/)
})

it("returns the features for a visible tab", async () => {
  mockFeatures.mockResolvedValue(new Set(["memberships"]))
  await expect(requireSettingsTab("/settings/members")).resolves.toEqual({ features: new Set(["memberships"]), data: undefined })
})

describe("load", () => {
  it("is not started for a non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER" } })
    const load = jest.fn()
    await expect(requireSettingsTab("/settings", load)).rejects.toThrow(/^NEXT_REDIRECT \/$/)
    expect(load).not.toHaveBeenCalled()
  })

  it("starts before the feature read settles and returns its result", async () => {
    let release!: (f: Set<string>) => void
    mockFeatures.mockReturnValue(new Promise((r) => { release = r }))
    const load = jest.fn().mockResolvedValue("rows")
    const result = requireSettingsTab("/settings", load)
    await Promise.resolve()
    await Promise.resolve()
    expect(load).toHaveBeenCalled()
    release(new Set())
    await expect(result).resolves.toEqual({ features: new Set(), data: "rows" })
  })

  it("redirects a hidden tab even when the load fails", async () => {
    const load = jest.fn().mockRejectedValue(new Error("db down"))
    await expect(requireSettingsTab("/settings/members", load)).rejects.toThrow(/^NEXT_REDIRECT \/settings$/)
  })

  it("re-raises a load failure on a visible tab", async () => {
    await expect(requireSettingsTab("/settings", () => Promise.reject(new Error("db down")))).rejects.toThrow("db down")
  })
})
