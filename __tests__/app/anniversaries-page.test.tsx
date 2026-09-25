/** @jest-environment node */
import Page from "@/app/(dashboard)/people/anniversaries/page"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { family: { findMany: jest.fn() } } }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("@/components/people/AnniversariesClient", () => ({ AnniversariesClient: () => null }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { PERSON_FETCH_CAP } from "@/lib/constants"

const family = (id: number) => ({ id, name: `F${id}`, marriageDate: new Date("2000-01-01T00:00:00Z"), people: [] })

describe("anniversaries page — fetch cap", () => {
  beforeEach(() => jest.clearAllMocks())

  it("fetches deterministically, one past the cap, and flags nothing when under it", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    ;(prisma.family.findMany as jest.Mock).mockResolvedValue([family(1)])
    const out = await Page({ searchParams: Promise.resolve({}) })
    expect(prisma.family.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { id: "asc" }, take: PERSON_FETCH_CAP + 1 }))
    expect(out.props.truncated).toBe(false)
  })

  it("flags truncation when more than the cap exist", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    ;(prisma.family.findMany as jest.Mock).mockResolvedValue(Array.from({ length: PERSON_FETCH_CAP + 1 }, (_, i) => family(i + 1)))
    const out = await Page({ searchParams: Promise.resolve({}) })
    expect(out.props.truncated).toBe(true)
  })
})
