// src/app/(dashboard)/settings/usage/__tests__/page.test.tsx
/** @jest-environment node */
import UsagePage from "../page"
import { auth } from "@/auth"
import { getUsageSummary } from "@/lib/usage"
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/usage", () => ({ getUsageSummary: jest.fn() }))
jest.mock("@/lib/routeViews", () => ({
  getTopRoutes: jest.fn().mockResolvedValue([{ route: "/reports", count: 40 }]),
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
}))

const mockAuth = auth as jest.Mock
const mockSummary = getUsageSummary as jest.Mock

describe("UsagePage", () => {
  beforeEach(() => jest.clearAllMocks())

  it("redirects a non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    await expect(UsagePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT")
  })

  it("renders adoption + dormant for an admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
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
