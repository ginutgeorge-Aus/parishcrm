/** @jest-environment node */

jest.mock("@/lib/xferAccount", () => ({ findXferAccountId: jest.fn().mockResolvedValue(9), XFER_OUT_PREFIX: "XFER_OUT_" }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn().mockResolvedValue({ id: 2 }) }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v.replace("enc:", "")) }))
jest.mock("@/lib/accountingLock", () => ({
  ...jest.requireActual("@/lib/accountingLock"),
  getAccountingLockDate: jest.fn().mockResolvedValue(null),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { transaction: { findMany: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import { listImportedTransferCandidates } from "../pettyCashTransferCandidates"

const amt = (v: string) => ({ toFixed: () => v })
const legRow = (o: Record<string, unknown> = {}) => ({
  type: "EXPENSE", accountId: 9, reconciled: false, paymentAccountId: 2, pettyCashTransferId: null,
  bankRef: "XFER_OUT_A", date: new Date("2026-07-31"), amount: amt("50.00"), ...o,
})
const depRow = (o: Record<string, unknown> = {}) => ({
  id: 1, accountId: 9, type: "INCOME", bankRef: "A", date: new Date("2026-07-31"), amount: amt("50.00"), description: "x", ...o,
})

const findMany = prisma.transaction.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

it("returns [] when no unlinked XFER_OUT legs exist", async () => {
  findMany.mockResolvedValueOnce([])
  await expect(listImportedTransferCandidates()).resolves.toEqual({ options: [], truncated: false })
  expect(findMany).toHaveBeenCalledTimes(1)
})


it("maps deposits of unlinked legs, decrypting the description", async () => {
  findMany
    .mockResolvedValueOnce([
      legRow({ reconciled: false, paymentAccountId: 2, bankRef: "XFER_OUT_ANZ_1", date: new Date("2026-07-31"), amount: amt("50.00") }),
      legRow({ reconciled: false, paymentAccountId: 2, bankRef: null, date: new Date("2026-07-31"), amount: amt("1.00") }),
    ])
    .mockResolvedValueOnce([
      depRow({ id: 7, bankRef: "ANZ_1", date: new Date("2026-07-31"), amount: amt("50.00"), description: "enc:Cash deposit" }),
    ])
  await expect(listImportedTransferCandidates()).resolves.toEqual({
    options: [{ id: 7, date: "2026-07-31", amount: "50.00", description: "Cash deposit" }],
    truncated: false,
  })
  expect(findMany.mock.calls[1][0].where.bankRef).toEqual({ in: ["ANZ_1"] })
})

it("only lists unreconciled legs on the cash payment account", async () => {
  findMany.mockResolvedValueOnce([])
  await listImportedTransferCandidates()
  expect(findMany.mock.calls[0][0].where).toEqual(
    expect.objectContaining({ reconciled: false, paymentAccountId: 2, pettyCashTransferId: null })
  )
})

it("drops deposits whose leg amount or date disagrees", async () => {
  findMany
    .mockResolvedValueOnce([
      legRow({ reconciled: false, paymentAccountId: 2, bankRef: "XFER_OUT_A", date: new Date("2026-07-31"), amount: amt("50.00") }),
      legRow({ reconciled: false, paymentAccountId: 2, bankRef: "XFER_OUT_B", date: new Date("2026-07-31"), amount: amt("50.00") }),
    ])
    .mockResolvedValueOnce([
      depRow({ id: 1, bankRef: "A", date: new Date("2026-07-31"), amount: amt("60.00"), description: "x" }),
      depRow({ id: 2, bankRef: "B", date: new Date("2026-08-01"), amount: amt("50.00"), description: "y" }),
    ])
  await expect(listImportedTransferCandidates()).resolves.toEqual({ options: [], truncated: false })
})

it("returns [] without creating when XFER account is absent", async () => {
  const { findXferAccountId } = jest.requireMock("@/lib/xferAccount")
  findXferAccountId.mockResolvedValueOnce(null)
  await expect(listImportedTransferCandidates()).resolves.toEqual({ options: [], truncated: false })
  expect(findMany).not.toHaveBeenCalled()
})

it("starts the leg query the day after the lock and caps the leg list newest-first", async () => {
  const { getAccountingLockDate } = jest.requireMock("@/lib/accountingLock")
  const lock = new Date("2026-06-30")
  getAccountingLockDate.mockResolvedValueOnce(lock)
  findMany
    .mockResolvedValueOnce([legRow({ reconciled: false, paymentAccountId: 2, bankRef: "XFER_OUT_A", date: new Date("2026-07-31"), amount: amt("50.00") })])
    .mockResolvedValueOnce([depRow({ id: 1, bankRef: "A", date: new Date("2026-07-31"), amount: amt("50.00"), description: "x" })])
  await listImportedTransferCandidates()
  expect(findMany.mock.calls[0][0].where.date).toEqual({ gte: new Date("2026-07-01") })
  expect(findMany.mock.calls[0][0].take).toBe(1000)
  expect(findMany.mock.calls[0][0].orderBy).toEqual({ date: "desc" })
  expect(findMany.mock.calls[1][0].take).toBeUndefined()
})

it("drops a leg that turned reconciled or off the cash account", async () => {
  findMany
    .mockResolvedValueOnce([
      legRow({ reconciled: true, paymentAccountId: 2, bankRef: "XFER_OUT_A", date: new Date("2026-07-31"), amount: amt("50.00") }),
      legRow({ reconciled: false, paymentAccountId: 5, bankRef: "XFER_OUT_B", date: new Date("2026-07-31"), amount: amt("50.00") }),
    ])
    .mockResolvedValueOnce([
      depRow({ id: 1, bankRef: "A", date: new Date("2026-07-31"), amount: amt("50.00"), description: "x" }),
      depRow({ id: 2, bankRef: "B", date: new Date("2026-07-31"), amount: amt("50.00"), description: "y" }),
    ])
  await expect(listImportedTransferCandidates()).resolves.toEqual({ options: [], truncated: false })
})

it("excludes a leg on the lock day itself (even at 05:00Z) via the query bound", async () => {
  const { getAccountingLockDate } = jest.requireMock("@/lib/accountingLock")
  getAccountingLockDate.mockResolvedValueOnce(new Date("2026-06-30"))
  findMany.mockResolvedValueOnce([])
  await listImportedTransferCandidates()
  const gte = findMany.mock.calls[0][0].where.date.gte as Date
  expect(new Date("2026-06-30T05:00:00Z").getTime()).toBeLessThan(gte.getTime())
  expect(new Date("2026-07-01T00:00:00Z").getTime()).toBeGreaterThanOrEqual(gte.getTime())
})

it("flags truncation when the leg cap is hit, even with no valid pairs", async () => {
  findMany.mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => legRow({ bankRef: `XFER_OUT_R${i}` })))
  findMany.mockResolvedValueOnce([])
  await expect(listImportedTransferCandidates()).resolves.toEqual({ options: [], truncated: true })
})

it("keeps older valid pairs and caps only the final list, flagging truncation", async () => {
  const refs = Array.from({ length: 205 }, (_, i) => `R${i}`)
  findMany
    .mockResolvedValueOnce(refs.map((r) => legRow({ bankRef: `XFER_OUT_${r}` })))
    .mockResolvedValueOnce(refs.map((r, i) => depRow({ id: i + 1, bankRef: r })))
  const res = await listImportedTransferCandidates()
  expect(res.options).toHaveLength(200)
  expect(res.truncated).toBe(true)
})

it("drops a pair whose leg is not an EXPENSE on the XFER account", async () => {
  findMany
    .mockResolvedValueOnce([legRow({ type: "INCOME" })])
    .mockResolvedValueOnce([depRow()])
  await expect(listImportedTransferCandidates()).resolves.toEqual({ options: [], truncated: false })
})
