/** @jest-environment node */

jest.mock("@/lib/featureFlags")
import { createTransfer } from "../pettyCashTransfer"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/xferAccount", () => ({ getXferAccountId: jest.fn().mockResolvedValue(9), XFER_OUT_PREFIX: "XFER_OUT_" }))
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

describe("createTransfer — imported deposit", () => {
  const deposit = { accountId: 9, type: "INCOME", amount: { toFixed: () => "50.00" }, date: new Date("2026-07-31"), bankRef: "ANZ_1" }
  function run(txMock: Record<string, unknown>) {
    mock$tx.mockImplementation((fn: (tx: unknown) => unknown) => fn(txMock))
    const fd = form()
    fd.set("importedTransactionId", "7")
    return createTransfer(1, undefined, fd)
  }
  const okLeg = { id: 11, type: "EXPENSE", accountId: 9, amount: { toFixed: () => "50.00" }, paymentAccountId: 2, pettyCashTransferId: null, reconciled: false }
  const base = () => ({
    pettyCashSession: { findUnique: jest.fn().mockResolvedValue({ status: "OPEN", title: "S", openingBalance: 100, receipts: [], expenses: [], transfers: [] }) },
    pettyCashTransfer: { create: jest.fn().mockResolvedValue({ id: 3 }) },
  })

  it("links the existing XFER_OUT leg instead of creating a mirror", async () => {
    const update = jest.fn()
    const create = jest.fn()
    const findUnique = jest.fn()
      .mockResolvedValueOnce(deposit)
      .mockResolvedValueOnce(okLeg)
    await run({ ...base(), transaction: { findUnique, update, create } })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11 }, data: expect.objectContaining({ pettyCashTransferId: 3 }) }))
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects when the leg is already linked", async () => {
    const findUnique = jest.fn()
      .mockResolvedValueOnce(deposit)
      .mockResolvedValueOnce({ ...okLeg, pettyCashTransferId: 2 })
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Imported deposit is not available for transfer" })
  })

  it("rejects an amount mismatch", async () => {
    const findUnique = jest.fn()
      .mockResolvedValueOnce({ ...deposit, amount: { toFixed: () => "60.00" } })
      .mockResolvedValueOnce(okLeg)
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Date and amount must match the imported deposit" })
  })

  const rejects = (name: string, dep: unknown, leg: unknown, error: string) =>
    it(name, async () => {
      const findUnique = jest.fn().mockResolvedValueOnce(dep).mockResolvedValueOnce(leg)
      await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } })).resolves.toEqual({ error })
    })
  const NA = "Imported deposit is not available for transfer"
  rejects("rejects a missing deposit", null, null, NA)
  rejects("rejects a deposit on the wrong account", { ...deposit, accountId: 4 }, okLeg, NA)
  rejects("rejects a non-INCOME deposit", { ...deposit, type: "EXPENSE" }, okLeg, NA)
  rejects("rejects a deposit with no bankRef", { ...deposit, bankRef: null }, null, NA)
  rejects("rejects a date mismatch", { ...deposit, date: new Date("2026-07-30") }, okLeg, "Date and amount must match the imported deposit")
  rejects("rejects a reconciled leg", deposit, { ...okLeg, reconciled: true }, "Imported deposit's cash-out is already reconciled")
  rejects("rejects a leg on the wrong payment account", deposit, { ...okLeg, paymentAccountId: null }, "Imported deposit's cash-out entry does not match this transfer")
})
