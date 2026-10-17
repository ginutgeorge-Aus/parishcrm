/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { family: { findMany: jest.fn() } } }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import NewPersonPage from "../page"

const mockFindMany = prisma.family.findMany as jest.Mock

describe("NewPersonPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  })

  it("sends the user to add a family first when none exist", async () => {
    mockFindMany.mockResolvedValue([])
    const html = renderToStaticMarkup(await NewPersonPage())
    expect(html).toContain("Add a family first")
    expect(html).toContain('href="/families/new"')
    expect(html).not.toContain("Continue")
  })

  it("shows the family picker when families exist", async () => {
    mockFindMany.mockResolvedValue([{ id: 4, name: "Example Family" }])
    const html = renderToStaticMarkup(await NewPersonPage())
    expect(html).toContain("Continue")
    expect(html).not.toContain("Add a family first")
  })

  it("redirects roles that can't edit", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    await expect(NewPersonPage()).rejects.toThrow("REDIRECT")
  })
})
