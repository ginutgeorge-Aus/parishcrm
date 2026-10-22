/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { auditLog: { findMany: jest.fn(), count: jest.fn() } },
}))
jest.mock("@/components/settings/AuditLogFilters", () => ({ AuditLogFilters: () => null }))
import { requireSettingsTab } from "@/lib/settingsAccess"
import { prisma } from "@/lib/prisma"
import AuditLogPage from "../page"

const mockRequire = requireSettingsTab as jest.Mock
/**
 * Lets the guard pass and runs the page's load, as the real guard does.
 * @param features enabled features to report
 */
const allow = (features: Set<string>) =>
  mockRequire.mockImplementation(async (_href: string, load?: () => Promise<unknown>) => ({ features, data: await load?.() }))

beforeEach(() => {
  jest.clearAllMocks()
  allow(new Set())
  ;(prisma.auditLog.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.auditLog.count as jest.Mock).mockResolvedValue(0)
})

it("guards with its own tab href", async () => {
  await AuditLogPage({ searchParams: Promise.resolve({}) })
  expect(mockRequire).toHaveBeenCalledWith("/settings/audit-log", expect.any(Function))
})

it("propagates the guard's redirect", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(AuditLogPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT")
})

it("renders inside the Audit Log card", async () => {
  render(await AuditLogPage({ searchParams: Promise.resolve({}) }))
  expect(screen.getByLabelText("Audit Log")).toBeInTheDocument()
  expect(screen.getAllByText("No audit log entries found.").length).toBeGreaterThan(0)
})
