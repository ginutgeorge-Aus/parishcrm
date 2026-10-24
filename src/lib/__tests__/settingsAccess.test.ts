/** @jest-environment node */
jest.mock("next/navigation", () => ({ redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }) }))
jest.mock("@/auth", () => ({ getSession: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ getEnabledFeatures: jest.fn() }))

import { getSession } from "@/auth"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { requireSettingsTab, getSettingsSession } from "@/lib/settingsAccess"

const mockAuth = getSession as unknown as jest.Mock
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
  await expect(requireSettingsTab("/settings/members")).resolves.toEqual({ features: new Set(["memberships"]), data: null })
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
    await new Promise((r) => setImmediate(r)) // let queued microtasks run, not an exact tick count
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

describe("cached session getter", () => {
  it("reads the session through the shared getSession", async () => {
    mockAuth.mockClear()
    await requireSettingsTab("/settings")
    expect(mockAuth).toHaveBeenCalledTimes(1)
    expect(getSettingsSession).toBe(getSession)
  })
})

describe("overload typing", () => {
  it("types data as null without load and as the load result with it", async () => {
    const none = await requireSettingsTab("/settings")
    // @ts-expect-error data is null when no load is passed, not a non-nullable value
    const asString: string = none.data
    expect(none.data).toBeNull()
    const some = await requireSettingsTab("/settings", async () => 42)
    const n: number = some.data
    expect(n).toBe(42)
    void asString
  })
})
