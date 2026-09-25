/** @jest-environment node */

// this print page had a NaN/lower-bound id guard but was missing the
// upper-bound check (`id > 2147483647`) that its sibling print pages
// (memberships, events registrations) already carry.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: { pettyCashSession: { findUnique: jest.fn() } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import PettyCashPrintPage from "@/app/(print)/petty-cash/sessions/[id]/print/page"

const mockAuth = auth as jest.Mock
const mockFindUnique = prisma.pettyCashSession.findUnique as jest.Mock
const mockNotFound = notFound as unknown as jest.Mock

const makeProps = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => jest.clearAllMocks())

describe("PettyCashPrintPage id guard", () => {
  it("notFound for a non-numeric id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await expect(PettyCashPrintPage(makeProps("abc"))).rejects.toThrow("NOT_FOUND")
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it("notFound for id <= 0", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await expect(PettyCashPrintPage(makeProps("0"))).rejects.toThrow("NOT_FOUND")
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it("notFound for id above the Postgres int4 bound", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await expect(PettyCashPrintPage(makeProps("99999999999"))).rejects.toThrow("NOT_FOUND")
    expect(mockNotFound).toHaveBeenCalled()
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
