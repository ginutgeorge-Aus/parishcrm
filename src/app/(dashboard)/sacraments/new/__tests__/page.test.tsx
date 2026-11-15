/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { person: { findMany: jest.fn(), findFirst: jest.fn() } } }))
jest.mock("@/lib/actions/sacrament", () => ({ createSacramentRecord: jest.fn() }))
jest.mock("@/components/sacraments/SacramentForm", () => ({ SacramentForm: () => null }))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import NewSacramentPage from "../page"

const mockAuth = auth as jest.Mock
const findMany = prisma.person.findMany as jest.Mock
const findFirst = prisma.person.findFirst as jest.Mock

/** Render the page for given search params. */
async function render(sp: { q?: string; personId?: string } = {}): Promise<string> {
  return renderToStaticMarkup((await NewSacramentPage({ searchParams: Promise.resolve(sp) })) as React.ReactElement)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "PASTOR" } })
  findMany.mockResolvedValue([{ id: 4, firstName: "Alex", lastName: "Sample", family: { name: "Sample Family" } }])
})

describe("NewSacramentPage person search", () => {
  it.each(["OFFICE_ADMIN", "VIEWER", "AUDITOR"])("redirects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    await expect(render({ q: "alex" })).rejects.toThrow("REDIRECT:/sacraments")
    expect(findMany).not.toHaveBeenCalled()
  })

  it("ANDs the words, each matching first or last name, over current people", async () => {
    const html = await render({ q: "alex sam" })
    const where = findMany.mock.calls[0][0].where
    expect(where.archivedAt).toBeNull()
    expect(where.AND).toHaveLength(2)
    expect(where.AND[0].OR).toEqual([
      { firstName: { contains: "alex", mode: "insensitive" } },
      { lastName: { contains: "alex", mode: "insensitive" } },
    ])
    expect(html).toContain("/sacraments/new?personId=4")
  })

  it("does not query without a search", async () => {
    await render()
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe("NewSacramentPage with a chosen person", () => {
  it("looks the person up among current (not archived) people and shows the form", async () => {
    findFirst.mockResolvedValue({ id: 4, firstName: "Alex", lastName: "Sample", family: { name: "Sample Family" } })
    const html = await render({ personId: "4" })
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 4, archivedAt: null })
    expect(html).toContain("/people/4")
    expect(html).toContain("Change person")
    expect(findMany).not.toHaveBeenCalled()
  })

  it("404s for an archived or unknown person", async () => {
    findFirst.mockResolvedValue(null)
    await expect(render({ personId: "4" })).rejects.toThrow("NOT_FOUND")
  })
})
