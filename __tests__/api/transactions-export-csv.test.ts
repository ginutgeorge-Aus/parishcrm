/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/transactionExport", () => ({
  generateTransactionCsv: jest.fn(() => "csv"),
}))

import { GET } from "@/app/api/accounting/transactions/export-csv/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest } from "next/server"

const mockAuth = auth as jest.Mock
const mockFindMany = prisma.transaction.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

it("caps findMany at take: 10000", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  mockFindMany.mockResolvedValue([])
  await GET(new NextRequest("http://localhost/api/accounting/transactions/export-csv"))
  expect(mockFindMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 10000 })
  )
})

it("defaults from to FY start (1 July), not calendar year", async () => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] }).setSystemTime(new Date("2026-03-15T12:00:00"))
  try {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([])
    await GET(new NextRequest("http://localhost/api/accounting/transactions/export-csv"))
    const where = mockFindMany.mock.calls[0][0].where
    // March 2026 falls in FY 2025 (Jul 2025–Jun 2026)
    expect(where.date.gte).toEqual(new Date("2025-07-01"))
  } finally {
    jest.useRealTimers()
  }
})

it("applies fund filter — specific fund id", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  mockFindMany.mockResolvedValue([])
  await GET(new NextRequest("http://localhost/api/accounting/transactions/export-csv?fund=5"))
  expect(mockFindMany.mock.calls[0][0].where).toEqual(
    expect.objectContaining({ fundId: 5 })
  )
})

it("applies fund filter — 'none' means untagged rows", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  mockFindMany.mockResolvedValue([])
  await GET(new NextRequest("http://localhost/api/accounting/transactions/export-csv?fund=none"))
  expect(mockFindMany.mock.calls[0][0].where).toEqual(
    expect.objectContaining({ fundId: null })
  )
})

it("returns 403 for VIEWER without accounting access", async () => {
  mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
  const res = await GET(new NextRequest("http://localhost/api/accounting/transactions/export-csv"))
  expect(res.status).toBe(403)
  expect(mockFindMany).not.toHaveBeenCalled()
})

// A malformed id/date filter used to be silently dropped, broadening the
// export to ALL records (or, for "12abc", truncating to id 12) rather than
// signalling the filter was ignored. Reject with 400 instead —
// mirrors the route's existing invalid-enum-param 400s.
it.each(["abc", "12abc", "0", "-5"])("400s on a malformed ?account=%s", async (v) => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  const res = await GET(new NextRequest(`http://localhost/api/accounting/transactions/export-csv?account=${v}`))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "Invalid account" })
  expect(mockFindMany).not.toHaveBeenCalled()
})

it("400s on a malformed ?family=", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  const res = await GET(new NextRequest("http://localhost/api/accounting/transactions/export-csv?family=nope"))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "Invalid family" })
})

it("400s on a malformed ?fund= (not 'none', not an id)", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  const res = await GET(new NextRequest("http://localhost/api/accounting/transactions/export-csv?fund=12abc"))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "Invalid fund" })
})

it("400s on a malformed ?from= date instead of falling back to FY start", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  const res = await GET(new NextRequest("http://localhost/api/accounting/transactions/export-csv?from=not-a-date"))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "Invalid date" })
  expect(mockFindMany).not.toHaveBeenCalled()
})

it("400s on a malformed ?to= date instead of dropping the upper bound", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  const res = await GET(new NextRequest("http://localhost/api/accounting/transactions/export-csv?to=2026-13-40"))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "Invalid date" })
})
