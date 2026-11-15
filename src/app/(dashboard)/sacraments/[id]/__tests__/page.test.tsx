/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/actions/sacrament", () => ({ getSacramentRecord: jest.fn(), updateSacramentRecord: jest.fn() }))
jest.mock("@/components/sacraments/DeleteSacramentButton", () => ({ DeleteSacramentButton: () => null }))
jest.mock("@/components/sacraments/SacramentForm", () => ({
  SacramentForm: ({ record }: { record: { registerNo: string } }) => <div data-form={record.registerNo} />,
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { getSacramentRecord } from "@/lib/actions/sacrament"
import SacramentPage from "../page"
import EditSacramentPage from "../edit/page"

const mockAuth = auth as jest.Mock
const getRecord = getSacramentRecord as jest.Mock

const RECORD = {
  id: 5,
  type: "MARRIAGE",
  registerNo: "MAR-2026-003",
  date: "2026-03-01",
  place: "St Mark",
  ministerName: null,
  person: { id: 8, firstName: "Alex", lastName: "Sample" },
  spouse: { id: 9, firstName: "Sam", lastName: "Other" },
  spouseName: null,
  godparents: "Jane Roe",
  notes: "private note",
  updatedAt: "2026-03-02T00:00:00.000Z",
}

type Page = (p: { params: Promise<{ id: string }> }) => Promise<unknown>

/** Render a page for a route id. */
async function render(page: Page, id = "5"): Promise<string> {
  return renderToStaticMarkup((await page({ params: Promise.resolve({ id }) })) as React.ReactElement)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "PASTOR" } })
  getRecord.mockResolvedValue(RECORD)
})

describe("SacramentPage (detail)", () => {
  it("redirects signed-out users to login", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(render(SacramentPage)).rejects.toThrow("REDIRECT:/login")
  })

  it.each(["VIEWER", "AUDITOR"])("redirects %s home", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    await expect(render(SacramentPage)).rejects.toThrow("REDIRECT:/")
    expect(getRecord).not.toHaveBeenCalled()
  })

  it("404s on a bad id or a missing entry, without an audit row", async () => {
    await expect(render(SacramentPage, "abc")).rejects.toThrow("NOT_FOUND")
    getRecord.mockResolvedValue(null)
    await expect(render(SacramentPage)).rejects.toThrow("NOT_FOUND")
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("shows the entry with edit links for an editor and audits the read with ids only", async () => {
    const html = await render(SacramentPage)
    expect(html).toContain("MAR-2026-003")
    expect(html).toContain("/people/9")
    expect(html).toContain("private note")
    expect(html).toContain("/sacraments/5/edit")
    expect(html).toContain("/sacraments/5/certificate")
    expect(logAudit).toHaveBeenCalledWith(1, "VIEW_SACRAMENT_RECORD", "SacramentRecord", 5, {
      registerNo: "MAR-2026-003",
      type: "MARRIAGE",
      personId: 8,
    })
    expect(JSON.stringify((logAudit as jest.Mock).mock.calls)).not.toContain("private note")
  })

  it("hides edit for OFFICE_ADMIN and prints a typed spouse name", async () => {
    mockAuth.mockResolvedValue({ user: { id: "2", role: "OFFICE_ADMIN" } })
    getRecord.mockResolvedValue({ ...RECORD, spouse: null, spouseName: "Out Side", notes: null })
    const html = await render(SacramentPage)
    expect(html).not.toContain("/sacraments/5/edit")
    expect(html).toContain("Out Side")
    expect(html).toContain("Sponsors / witnesses")
  })
})

describe("EditSacramentPage", () => {
  it.each(["OFFICE_ADMIN", "VIEWER"])("redirects %s to the register", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    await expect(render(EditSacramentPage)).rejects.toThrow("REDIRECT:/sacraments")
    expect(getRecord).not.toHaveBeenCalled()
  })

  it("404s on a bad id or a missing entry", async () => {
    await expect(render(EditSacramentPage, "0")).rejects.toThrow("NOT_FOUND")
    getRecord.mockResolvedValue(null)
    await expect(render(EditSacramentPage)).rejects.toThrow("NOT_FOUND")
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("renders the form for the entry and audits the read", async () => {
    const html = await render(EditSacramentPage)
    expect(html).toContain('data-form="MAR-2026-003"')
    expect(html).toContain("Alex Sample")
    expect(logAudit).toHaveBeenCalledWith(1, "VIEW_SACRAMENT_RECORD", "SacramentRecord", 5, expect.objectContaining({ personId: 8 }))
  })
})
