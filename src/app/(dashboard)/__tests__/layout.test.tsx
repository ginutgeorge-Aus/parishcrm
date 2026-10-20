/** @jest-environment node */
const mockGroupBy = jest.fn()
const mockAuth = jest.fn()
jest.mock("@/auth", () => ({ auth: () => mockAuth() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    checkpointResult: { groupBy: (a: unknown) => mockGroupBy(a) },
    membershipApplication: { count: jest.fn().mockResolvedValue(0) },
  },
}))
jest.mock("@/lib/actions/settings", () => ({ getIdleTimeoutMinutes: jest.fn().mockResolvedValue(30) }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn().mockResolvedValue({ name: "Test Church" }) }))
jest.mock("@/lib/pendingUpdates", () => ({
  countPendingFamilyUpdates: jest.fn().mockResolvedValue(0),
  countPendingMemberships: jest.fn().mockResolvedValue(0),
}))
jest.mock("@/lib/featureFlags", () => ({
  getEnabledFeatures: jest.fn(async () => (await import("@/lib/features")).resolveFeatures({})),
}))
jest.mock("@/components/layout/Sidebar", () => ({ Sidebar: () => null }))
jest.mock("@/components/layout/TopBar", () => ({ TopBar: () => null }))
jest.mock("@/components/layout/ShellContext", () => ({ ShellProvider: ({ children }: { children: React.ReactNode }) => children }))
jest.mock("@/components/SiteFooter", () => ({ SiteFooter: () => null }))
jest.mock("@/components/auth/IdleTimeout", () => ({ IdleTimeout: () => null }))

import DashboardLayout from "../layout"
import { TEST_CHECKPOINTS } from "@/lib/testCheckpoints"

/** Depth-first search of the element tree for the first element whose props pass `match`. */
function findProps(tree: unknown, match: (p: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  const el = tree as { props?: Record<string, unknown> } | null
  if (!el || typeof el !== "object") return undefined
  if (el.props && match(el.props)) return el.props
  const kids = el.props?.children
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const found = findProps(k, match)
    if (found) return found
  }
  return undefined
}

/** Props of the Sidebar element (the only one carrying `verifyPending`). */
function sidebarProps(tree: unknown): Record<string, unknown> | undefined {
  return findProps(tree, (p) => "verifyPending" in p)
}

describe("DashboardLayout verify badge", () => {
  beforeEach(() => jest.clearAllMocks())

  it("counts untested checkpoints via a DB-side groupBy over current ids", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
    mockGroupBy.mockResolvedValue([{ checkpointId: TEST_CHECKPOINTS[0].id }, { checkpointId: TEST_CHECKPOINTS[1].id }])
    const props = sidebarProps(await DashboardLayout({ children: null }))
    expect(props?.verifyPending).toBe(TEST_CHECKPOINTS.length - 2)
    expect(mockGroupBy).toHaveBeenCalledWith({
      by: ["checkpointId"],
      where: { checkpointId: { in: TEST_CHECKPOINTS.map((c) => c.id) } },
    })
  })

  it("skips the query for non-admins", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER" } })
    const props = sidebarProps(await DashboardLayout({ children: null }))
    expect(props?.verifyPending).toBe(0)
    expect(mockGroupBy).not.toHaveBeenCalled()
  })
})

/**
 * Walks the returned React element tree and returns the props of the IdleTimeout element.
 */
function idleProps(tree: unknown): Record<string, unknown> | undefined {
  const el = tree as { props?: Record<string, unknown> } | null
  if (!el || typeof el !== "object") return undefined
  if (el.props && "idleMinutes" in el.props) return el.props
  const kids = el.props?.children
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const found = idleProps(k)
    if (found) return found
  }
  return undefined
}

describe("DashboardLayout idle timeout", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGroupBy.mockResolvedValue([])
  })

  it("uses the configured idle window for a non-remembered session", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER" } })
    expect(idleProps(await DashboardLayout({ children: null }))?.idleMinutes).toBe(30)
  })

  it("uses the 7-day sliding window for a remembered session", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER" }, remember: true })
    expect(idleProps(await DashboardLayout({ children: null }))?.idleMinutes).toBe(7 * 24 * 60)
  })
})

describe("DashboardLayout top bar", () => {
  beforeEach(() => jest.clearAllMocks())

  it("passes the pending counts and church name to the top bar", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
    mockGroupBy.mockResolvedValue([])
    const tree = await DashboardLayout({ children: null })
    const top = findProps(tree, (p) => "churchName" in p && !("verifyPending" in p))
    expect(top).toMatchObject({ churchName: "Test Church", pendingUpdates: 0, membershipPending: 0 })
    expect(Array.isArray(top?.features)).toBe(true)
  })
})
