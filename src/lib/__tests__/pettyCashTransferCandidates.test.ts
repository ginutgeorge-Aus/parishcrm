/** @jest-environment node */

jest.mock("@/lib/xferAccount", () => ({ getXferAccountId: jest.fn().mockResolvedValue(9), XFER_OUT_PREFIX: "XFER_OUT_" }))
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

it("maps deposits of unlinked legs, decrypting the description", async () => {
  findMany
    .mockResolvedValueOnce([{ bankRef: "XFER_OUT_ANZ_1" }, { bankRef: null }])
    .mockResolvedValueOnce([
      { id: 7, date: new Date("2026-07-31"), amount: { toFixed: () => "50.00" }, description: "enc:Cash deposit" },
    ])
  await expect(listImportedTransferCandidates()).resolves.toEqual([
    { id: 7, date: "2026-07-31", amount: "50.00", description: "Cash deposit" },
  ])
  expect(findMany.mock.calls[1][0].where.bankRef).toEqual({ in: ["ANZ_1"] })
})
