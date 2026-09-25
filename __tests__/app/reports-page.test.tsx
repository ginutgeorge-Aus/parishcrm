/** @jest-environment node */

import { renderToStaticMarkup } from "react-dom/server"
import ReportsPage from "@/app/(dashboard)/reports/page"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("@/lib/actions/feedback", () => ({ syncMyReports: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/prisma", () => ({ prisma: { report: { findMany: jest.fn() } } }))

import { auth } from "@/auth"
import { syncMyReports } from "@/lib/actions/feedback"
import { prisma } from "@/lib/prisma"

const mockAuth = auth as jest.Mock
const mockSync = syncMyReports as jest.Mock
const mockFindMany = prisma.report.findMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "7", role: "VIEWER" } })
  mockFindMany.mockResolvedValue([])
})

it("redirects an unauthenticated visitor", async () => {
  mockAuth.mockResolvedValue(null)
  await expect(ReportsPage()).rejects.toThrow("REDIRECT")
})

it("syncs status then queries only this user's reports", async () => {
  await ReportsPage()
  expect(mockSync).toHaveBeenCalled()
  expect(mockFindMany.mock.calls[0][0].where).toEqual({ userId: 7 })
})

it("renders the reports with type and status", async () => {
  mockFindMany.mockResolvedValue([
    { id: 1, type: "BUG", title: "Bug: broke", summary: "broke", status: "RESOLVED", createdAt: new Date("2026-06-01") },
    { id: 2, type: "FEATURE", title: "Feature: dark mode", summary: "dark mode", status: "OPEN", createdAt: new Date("2026-06-02") },
  ])
  const html = renderToStaticMarkup(await ReportsPage())
  expect(html).toContain("dark mode")
  expect(html).toContain("Resolved")
  expect(html).toContain("Open")
})

it("shows an empty state when there are no reports", async () => {
  const html = renderToStaticMarkup(await ReportsPage())
  expect(html).toContain("haven")
})
