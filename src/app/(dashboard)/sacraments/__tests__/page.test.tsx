/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { sacramentRecord: { findMany: jest.fn() } } }))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import SacramentsPage from "../page"

const mockAuth = auth as jest.Mock
const findMany = prisma.sacramentRecord.findMany as jest.Mock

const ROW = {
  id: 3,
  type: "BAPTISM",
  registerNo: "BAP-2026-001",
  date: new Date("2026-03-01T00:00:00Z"),
  place: "St Mark",
  person: { id: 8, firstName: "Alex", lastName: "Sample" },
}

/** Render the page for given search params. */
async function render(sp: { type?: string; year?: string; page?: string } = {}): Promise<string> {
  return renderToStaticMarkup((await SacramentsPage({ searchParams: Promise.resolve(sp) })) as React.ReactElement)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "PASTOR" } })
  findMany.mockResolvedValue([ROW])
})

describe("SacramentsPage", () => {
  it("redirects signed-out users to login", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(render()).rejects.toThrow("REDIRECT:/login")
  })

  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER", "HEADMASTER", "TEACHER"])("redirects %s without querying", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    await expect(render()).rejects.toThrow("REDIRECT:/")
    expect(findMany).not.toHaveBeenCalled()
  })

  it("lists entries for an editor, with the add link", async () => {
    const html = await render()
    expect(html).toContain("BAP-2026-001")
    expect(html).toContain("Alex Sample")
    expect(html).toContain("1 March 2026")
    expect(html).toContain("/sacraments/new")
  })

  it("OFFICE_ADMIN reads the list without the add link", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const html = await render()
    expect(html).toContain("BAP-2026-001")
    expect(html).not.toContain("/sacraments/new")
  })

  it("passes valid type and year filters to the query", async () => {
    await render({ type: "MARRIAGE", year: "2026" })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "MARRIAGE", year: 2026 } }))
  })

  it("ignores an unknown type and a malformed year", async () => {
    await render({ type: "NOPE", year: "20x6" })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
  })

  it("never selects the encrypted columns", async () => {
    await render()
    expect(JSON.stringify(findMany.mock.calls[0][0].select)).not.toMatch(/notes|godparents|spouseName/)
  })

  it("offers a next link keeping the filters when more than 500 rows exist", async () => {
    findMany.mockResolvedValue(Array.from({ length: 501 }, (_, i) => ({ ...ROW, id: i + 1 })))
    const html = await render({ type: "MARRIAGE", year: "2026" })
    expect(html).toContain("Page 1")
    expect(html).toContain("/sacraments?type=MARRIAGE&amp;year=2026&amp;page=2")
    expect(html).not.toContain("Previous")
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 501 }))
  })

  it("page 2 skips the first 500 and links back, with no next link on the last page", async () => {
    findMany.mockResolvedValue([ROW])
    const html = await render({ page: "2" })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 500, take: 501 }))
    expect(html).toContain("Page 2")
    expect(html).toContain('href="/sacraments"')
    expect(html).not.toContain("Next")
  })

  it("treats a malformed page as page 1", async () => {
    await render({ page: "-3" })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }))
  })

  it("shows the empty state", async () => {
    findMany.mockResolvedValue([])
    expect(await render({ year: "2026" })).toContain("No entries match these filters.")
  })
})
