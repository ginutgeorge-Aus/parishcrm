/** @jest-environment node */
import Page from "@/app/(dashboard)/people/birthdays/page"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { person: { findMany: jest.fn() } } }))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("@/components/people/BirthdaysClient", () => ({ BirthdaysClient: () => null }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { PERSON_FETCH_CAP } from "@/lib/constants"

describe("birthdays page", () => {
  beforeEach(() => jest.clearAllMocks())

  it("redirects when unauthenticated", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it("redirects AUDITOR away from member PII", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "AUDITOR", id: "9" } })
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/")
    expect(prisma.person.findMany).not.toHaveBeenCalled()
  })

  it("passes canEdit=false for VIEWER", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "VIEWER", id: "3" } })
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([])
    const out = await Page({ searchParams: Promise.resolve({}) })
    expect(out.props.canEdit).toBe(false)
    expect(out.props.rows).toHaveLength(0)
  })

  it("passes canEdit=true for ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([])
    const out = await Page({ searchParams: Promise.resolve({}) })
    expect(out.props.canEdit).toBe(true)
  })

  const person = (id: number) => ({ id, firstName: "P", lastName: String(id), dateOfBirth: "enc:1990-01-01", email: null, emailConsent: false, family: { name: "F" } })

  it("fetches deterministically, one past the cap, and flags nothing when under it", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([person(1)])
    const out = await Page({ searchParams: Promise.resolve({}) })
    expect(prisma.person.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { id: "asc" }, take: PERSON_FETCH_CAP + 1 }))
    expect(out.props.truncated).toBe(false)
  })

  it("flags truncation when more than the cap exist", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue(Array.from({ length: PERSON_FETCH_CAP + 1 }, (_, i) => person(i + 1)))
    const out = await Page({ searchParams: Promise.resolve({}) })
    expect(out.props.truncated).toBe(true)
  })
})
