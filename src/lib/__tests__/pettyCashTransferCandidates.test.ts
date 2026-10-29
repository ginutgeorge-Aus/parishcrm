/** @jest-environment node */

jest.mock("@/lib/xferAccount", () => ({ findXferAccountId: jest.fn().mockResolvedValue(9), XFER_OUT_PREFIX: "XFER_OUT_" }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn().mockResolvedValue({ id: 2 }) }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v.replace("enc:", "")) }))
jest.mock("@/lib/prisma", () => ({ prisma: { transaction: { findMany: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import { listImportedTransferCandidates } from "../pettyCashTransferCandidates"

const findMany = prisma.transaction.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

it("returns [] when no unlinked XFER_OUT legs exist", async () => {
  findMany.mockResolvedValueOnce([])
  await expect(listImportedTransferCandidates()).resolves.toEqual([])
  expect(findMany).toHaveBeenCalledTimes(1)
})

const amt = (v: string) => ({ toFixed: () => v })

it("maps deposits of unlinked legs, decrypting the description", async () => {
  findMany
    .mockResolvedValueOnce([
      { bankRef: "XFER_OUT_ANZ_1", date: new Date("2026-07-31"), amount: amt("50.00") },
      { bankRef: null, date: new Date("2026-07-31"), amount: amt("1.00") },
    ])
    .mockResolvedValueOnce([
      { id: 7, bankRef: "ANZ_1", date: new Date("2026-07-31"), amount: amt("50.00"), description: "enc:Cash deposit" },
    ])
  await expect(listImportedTransferCandidates()).resolves.toEqual([
    { id: 7, date: "2026-07-31", amount: "50.00", description: "Cash deposit" },
  ])
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
      { bankRef: "XFER_OUT_A", date: new Date("2026-07-31"), amount: amt("50.00") },
      { bankRef: "XFER_OUT_B", date: new Date("2026-07-31"), amount: amt("50.00") },
    ])
    .mockResolvedValueOnce([
      { id: 1, bankRef: "A", date: new Date("2026-07-31"), amount: amt("60.00"), description: "x" },
      { id: 2, bankRef: "B", date: new Date("2026-08-01"), amount: amt("50.00"), description: "y" },
    ])
  await expect(listImportedTransferCandidates()).resolves.toEqual([])
})

it("returns [] without creating when XFER account is absent", async () => {
  const { findXferAccountId } = jest.requireMock("@/lib/xferAccount")
  findXferAccountId.mockResolvedValueOnce(null)
  await expect(listImportedTransferCandidates()).resolves.toEqual([])
  expect(findMany).not.toHaveBeenCalled()
})
