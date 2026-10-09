/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/clearanceSettings", () => ({ getWwccVerifyUrl: jest.fn().mockResolvedValue("https://portal.example.test/login") }))
jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn() }))
jest.mock("@/lib/clearanceCompliance", () => ({
  ...jest.requireActual("@/lib/clearanceCompliance"),
  loadComplianceRows: jest.fn(),
  loadWwccVerifyBatch: jest.fn(),
}))
jest.mock("@/components/people/ClearanceComplianceTable", () => {
  const React = require("react")
  return { ClearanceComplianceTable: ({ rows }: { rows: unknown[] }) => React.createElement("div", { "data-testid": "table" }, `rows:${rows.length}`) }
})
jest.mock("@/components/people/WwccBatchVerify", () => {
  const React = require("react")
  return { WwccBatchVerify: ({ rows, verifyUrl }: { rows: unknown[]; verifyUrl: string }) => React.createElement("div", { "data-testid": "batch" }, `batch:${rows.length}:${verifyUrl}`) }
})

import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { loadComplianceRows, loadWwccVerifyBatch, toComplianceRow } from "@/lib/clearanceCompliance"
import ClearancesPage from "../page"

const mockAuth = auth as jest.Mock
const TODAY = new Date()
/** Builds a synthetic compliance row; `expired` gives an expired WWCC. */
const mkRow = (id: number, expired: boolean) => toComplianceRow({
  id, firstName: "P" + id, lastName: "Testperson", ministryRoles: ["STAFF"], family: { name: "F" },
  clearances: expired ? [{ id: id * 10, type: "WWCC", number: "x", expiresAt: new Date("2020-01-01T00:00:00Z"), verifiedAt: new Date() }] : [],
}, TODAY)

/** Renders the page to static markup with the given search params. */
async function render(sp: Record<string, string> = {}) {
  return renderToStaticMarkup(await ClearancesPage({ searchParams: Promise.resolve(sp) }))
}

describe("ClearancesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN", id: "7" } })
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: [mkRow(1, true), mkRow(2, false)], truncated: false })
    ;(loadWwccVerifyBatch as jest.Mock).mockResolvedValue([{ clearanceId: "c1" }])
  })

  it("redirects an unauthenticated visitor to /login", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(render()).rejects.toThrow("REDIRECT:/login")
  })
  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("redirects %s to /", async (role) => {
    mockAuth.mockResolvedValue({ user: { role, id: "7" } })
    await expect(render()).rejects.toThrow("REDIRECT:/")
    expect(loadComplianceRows).not.toHaveBeenCalled()
  })
  it("lists all rows with filter chips and a CSV link", async () => {
    const html = await render()
    expect(html).toContain("rows:2")
    expect(html).toContain("?status=expired")
    expect(html).toContain("/api/clearances/export")
    expect(html).toContain("view=batch")
  })
  it("applies a valid status filter and carries it into the CSV link", async () => {
    const html = await render({ status: "missing" })
    expect(html).toContain("rows:2") // both people have a MISSING cell
    expect(html).toContain("/api/clearances/export?status=missing")
  })
  it("ignores an unknown status", async () => {
    expect(await render({ status: "bogus" })).toContain("rows:2")
  })
  it("batch view loads the batch, passes the portal URL, and audits the view", async () => {
    const html = await render({ view: "batch" })
    expect(html).toContain("batch:1:https://portal.example.test/login")
    expect(loadComplianceRows).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(7, "CLEARANCE_BATCH_VIEWED", "Person", undefined, { rowCount: 1 })
  })
})
