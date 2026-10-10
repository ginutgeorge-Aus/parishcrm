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
jest.mock("@/lib/pendingUpdates", () => ({ countPendingFamilyUpdates: jest.fn().mockResolvedValue(0) }))
jest.mock("@/components/layout/Sidebar", () => ({ Sidebar: () => null }))
jest.mock("@/components/SiteFooter", () => ({ SiteFooter: () => null }))
jest.mock("@/components/auth/IdleTimeout", () => ({ IdleTimeout: () => null }))

import DashboardLayout from "../layout"
import { TEST_CHECKPOINTS } from "@/lib/testCheckpoints"

/**
 * Walks the returned React element tree and returns the props of the Sidebar element.
 */
function sidebarProps(tree: unknown): Record<string, unknown> | undefined {
  const el = tree as { props?: Record<string, unknown> } | null
  if (!el || typeof el !== "object") return undefined
  if (el.props && "verifyPending" in el.props) return el.props
  const kids = el.props?.children
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const found = sidebarProps(k)
    if (found) return found
  }
  return undefined
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
