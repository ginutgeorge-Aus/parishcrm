/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({
  getAccountingLockDate: jest.fn(),
  isDateLocked: jest.requireActual("@/lib/accountingLock").isDateLocked,
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
    account: { findMany: jest.fn() },
    family: { findMany: jest.fn() },
    person: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => true),
  __resetRateLimit: jest.fn(),
}))

import { POST } from "@/app/api/import/bank-statement/confirm/route"
import { auth } from "@/auth"
import { getAccountingLockDate } from "@/lib/accountingLock"
import { prisma } from "@/lib/prisma"
import { NextRequest } from "next/server"

const mockAuth = auth as jest.Mock
const mockLock = getAccountingLockDate as jest.Mock
const mockCreate = prisma.transaction.create as jest.Mock
const mockCreateMany = prisma.transaction.createMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

it("rejects the import with 400 when a row falls in the locked period", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  mockLock.mockResolvedValue(new Date("2026-06-30"))

  const body = [
    {
      date: "2026-05-01",
      description: "PAYMENT FROM TEST",
      details: "PAYMENT FROM TEST | TEST",
      amount: "100.00",
      type: "INCOME",
      bankRef: "ANZ_123_20260501_100.00_PAYMENTFROMTEST_999",
      accountId: 1,
      skip: false,
    },
  ]

  const req = new NextRequest("http://localhost/api/import/bank-statement/confirm", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(JSON.stringify(body))) },
  })

  const res = await POST(req)
  expect(res.status).toBe(400)
  expect(mockCreate).not.toHaveBeenCalled()
})

it("allows import when all rows are after the lock date", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  mockLock.mockResolvedValue(new Date("2026-04-30"))
  ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.account.findMany as jest.Mock).mockResolvedValue([{ id: 1, type: "INCOME", isActive: true }])
  ;(prisma.family.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([])
  mockCreateMany.mockResolvedValue({ count: 1 })

  const body = [
    {
      date: "2026-05-01",
      description: "PAYMENT FROM TEST",
      details: "PAYMENT FROM TEST | TEST",
      amount: "100.00",
      type: "INCOME",
      bankRef: "ANZ_123_20260501_100.00_PAYMENTFROMTEST_999",
      accountId: 1,
      skip: false,
    },
  ]

  const req = new NextRequest("http://localhost/api/import/bank-statement/confirm", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(JSON.stringify(body))) },
  })

  const res = await POST(req)
  expect(res.status).toBe(200)
  expect(mockCreateMany).toHaveBeenCalled()
})

it("passes through when no lock date is set", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  mockLock.mockResolvedValue(null)
  ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.account.findMany as jest.Mock).mockResolvedValue([{ id: 1, type: "INCOME", isActive: true }])
  ;(prisma.family.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([])
  mockCreateMany.mockResolvedValue({ count: 1 })

  const body = [
    {
      date: "2026-05-01",
      description: "PAYMENT FROM TEST",
      amount: "100.00",
      type: "INCOME",
      bankRef: "ANZ_123_20260501_100.00_PAYMENTFROMTEST_999",
      accountId: 1,
      skip: false,
    },
  ]

  const req = new NextRequest("http://localhost/api/import/bank-statement/confirm", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(JSON.stringify(body))) },
  })

  const res = await POST(req)
  expect(res.status).toBe(200)
  expect(mockCreateMany).toHaveBeenCalled()
})
