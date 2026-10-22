/** @jest-environment node */
// src/app/(dashboard)/settings/usage/__tests__/page.test.tsx
/** @jest-environment node */
import UsagePage from "../page"
import { requireSettingsTab } from "@/lib/settingsAccess"
import { getUsageSummary } from "@/lib/usage"
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
jest.mock("@/lib/usage", () => ({ getUsageSummary: jest.fn() }))
jest.mock("@/lib/routeViews", () => ({
  getTopRoutes: jest.fn().mockResolvedValue([{ route: "/reports", count: 40 }]),
}))

const mockRequire = requireSettingsTab as jest.Mock
/**
 * Lets the guard pass and runs the page's load, as the real guard does.
 * @param features enabled features to report
 */
const allow = (features: Set<string>) =>
  mockRequire.mockImplementation(async (_href: string, load?: () => Promise<unknown>) => ({ features, data: await load?.() }))
const mockSummary = getUsageSummary as jest.Mock

describe("UsagePage", () => {
  beforeEach(() => jest.clearAllMocks())

  it("guards with its own tab href and propagates the redirect", async () => {
    mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
    await expect(UsagePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT")
    expect(mockRequire).toHaveBeenCalledWith("/settings/usage", expect.any(Function))
  })

  it("renders adoption + dormant for an admin", async () => {
    allow(new Set())
    mockSummary.mockResolvedValue({
      days: 30,
      adoption: [{ resourceType: "Event", count: 9 }],
      activeUsers: 4,
      weeklyActiveUsers: [{ label: "2026-08-01", count: 2 }],
      weeklyTrend: [{ label: "2026-08-01", count: 5 }],
      dormant: ["Budget"],
    })
    const html = renderToStaticMarkup(await UsagePage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain("Event")
    expect(html).toContain("Budget")
    expect(html).toContain("/reports")
  })
})
