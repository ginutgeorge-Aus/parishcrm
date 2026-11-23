/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { sacramentRecord: { findMany: jest.fn(), count: jest.fn() } } }))
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
const count = prisma.sacramentRecord.count as jest.Mock

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
  count.mockResolvedValue(1)
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

  it("paginates: skips earlier pages and keeps filters in links", async () => {
    count.mockResolvedValue(250)
    const html = await render({ type: "MARRIAGE", year: "2026", page: "2" })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 100 }))
    expect(html).toContain("Page 2 of 3")
    expect(html).toContain("/sacraments?type=MARRIAGE&amp;year=2026")
    expect(html).toContain("page=3")
  })

  it("clamps an out-of-range or malformed page", async () => {
    count.mockResolvedValue(250)
    await render({ page: "99" })
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 200 }))
    await render({ page: "abc" })
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0 }))
  })

  it("hides pagination for a single page", async () => {
    expect(await render()).not.toContain("Register pages")
  })

  it("shows the no-match empty state with a clear-filters action", async () => {
    count.mockResolvedValue(0)
    findMany.mockResolvedValue([])
    const html = await render({ year: "2026" })
    expect(html).toContain("No entries match these filters")
    expect(html).toContain("Clear filters")
  })

  it("shows the no-data empty state with one add action for editors", async () => {
    count.mockResolvedValue(0)
    findMany.mockResolvedValue([])
    const html = await render()
    expect(html).toContain("No entries in the register yet")
    expect(html.match(/Add entry/g)).toHaveLength(1)
  })

  it("no-data empty state has no add action for read-only roles", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    count.mockResolvedValue(0)
    findMany.mockResolvedValue([])
    expect(await render()).not.toContain("Add entry")
  })
})
