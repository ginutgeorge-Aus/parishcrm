/** @jest-environment jsdom */
import { render } from "@testing-library/react"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany: jest.fn() },
    registration: { findMany: jest.fn() },
  },
}))
jest.mock("@/components/settings/ActivityFeed", () => ({
  ActivityFeed: (p: object) => <i data-c="ActivityFeed">{JSON.stringify(p)}</i>,
}))
import { requireSettingsTab } from "@/lib/settingsAccess"
import { prisma } from "@/lib/prisma"
import SecuritySettingsPage from "@/app/(dashboard)/settings/security/page"

const mockRequire = requireSettingsTab as jest.Mock
/**
 * Lets the guard pass and runs the page's load, as the real guard does.
 * @param features enabled features to report
 */
const allow = (features: Set<string>) =>
  mockRequire.mockImplementation(async (_href: string, load?: () => Promise<unknown>) => ({ features, data: await load?.() }))
const mockAudit = prisma.auditLog.findMany as jest.Mock
const mockReg = prisma.registration.findMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  allow(new Set())
  mockAudit.mockResolvedValue([{ id: 1, action: "USER_CREATED" }])
  mockReg.mockResolvedValue([{ id: 2, firstName: "Jo" }])
})

it("guards with its own tab href", async () => {
  await SecuritySettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings/security", expect.any(Function))
})

it("propagates the guard's redirect", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(SecuritySettingsPage()).rejects.toThrow("NEXT_REDIRECT")
})

it("queries the latest 10 audit entries and 5 registrations", async () => {
  await SecuritySettingsPage()
  expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ take: 10, orderBy: { createdAt: "desc" } }))
  expect(mockReg).toHaveBeenCalledWith(expect.objectContaining({ take: 5, orderBy: { createdAt: "desc" } }))
})

it("renders ActivityFeed with the fetched rows", async () => {
  const { container } = render(await SecuritySettingsPage())
  const feed = container.querySelector('[data-c="ActivityFeed"]')
  expect(feed).toBeInTheDocument()
  expect(feed).toHaveTextContent("USER_CREATED")
  expect(feed).toHaveTextContent('"firstName":"Jo"')
})
