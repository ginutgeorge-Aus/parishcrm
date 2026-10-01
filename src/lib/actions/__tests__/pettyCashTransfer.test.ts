/** @jest-environment node */

import { createTransfer } from "../pettyCashTransfer"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/xferAccount", () => ({ getXferAccountId: jest.fn().mockResolvedValue(9) }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn().mockResolvedValue({ id: 2 }) }))
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
const mock$tx = prisma.$transaction as jest.Mock

function form() {
  const fd = new FormData()
  fd.set("date", "2026-07-31")
  fd.set("amount", "50.00")
  fd.set("depositedByName", "Treasurer")
  return fd
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

describe("createTransfer — serialization conflicts", () => {
  it.each([
    ["P2034", { code: "P2034" }],
    // @prisma/adapter-pg sometimes surfaces Postgres 40001 unwrapped, with no `code`.
    ["unwrapped DriverAdapterError", { name: "DriverAdapterError", cause: { originalCode: "40001", kind: "TransactionWriteConflict" } }],
  ])("maps a %s to the retry prompt instead of a 500", async (_label, err) => {
    mock$tx.mockRejectedValue(err)
    await expect(createTransfer(1, undefined, form())).resolves.toEqual({ error: "Transfer conflict — please try again." })
  })

  it("rethrows an unrelated transaction error", async () => {
    mock$tx.mockRejectedValue(new Error("connection lost"))
    await expect(createTransfer(1, undefined, form())).rejects.toThrow("connection lost")
  })
})
