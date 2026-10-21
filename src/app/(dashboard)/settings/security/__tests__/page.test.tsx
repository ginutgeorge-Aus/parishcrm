/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

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
const mockAudit = prisma.auditLog.findMany as jest.Mock
const mockReg = prisma.registration.findMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue({ features: new Set() })
  mockAudit.mockResolvedValue([{ id: 1, action: "USER_CREATED" }])
  mockReg.mockResolvedValue([{ id: 2, firstName: "Jo" }])
})

it("guards with its own tab href", async () => {
  await SecuritySettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings/security")
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
  const html = renderToStaticMarkup(await SecuritySettingsPage())
  expect(html).toContain('data-c="ActivityFeed"')
  expect(html).toContain("USER_CREATED")
  expect(html).toContain("&quot;firstName&quot;:&quot;Jo&quot;")
})
