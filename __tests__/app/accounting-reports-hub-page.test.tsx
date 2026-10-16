/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))

import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import ReportsHubPage from "@/app/(dashboard)/accounting/reports/page"

const mockAuth = auth as jest.Mock

beforeEach(() => jest.clearAllMocks())

it("redirects roles without accounting view access", async () => {
  mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
  await expect(ReportsHubPage()).rejects.toThrow("REDIRECT")
  expect(redirect).toHaveBeenCalledWith("/")
})

it("links every report route under /accounting/reports for a read-only AUDITOR", async () => {
  mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
  const html = renderToStaticMarkup(await ReportsHubPage())

  // Every report directory must be reachable from the hub, since the sidebar
  // no longer links reports individually.
  const dir = path.join(process.cwd(), "src/app/(dashboard)/accounting/reports")
  // Only route segments (dirs with a page) — colocated helper dirs aren't reports.
  const reports = readdirSync(dir).filter((d) => existsSync(path.join(dir, d, "page.tsx")))
  expect(reports.length).toBeGreaterThan(0)
  for (const slug of reports) {
    expect(html).toContain(`href="/accounting/reports/${slug}"`)
  }
})
