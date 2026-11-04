/** @jest-environment node */

jest.mock("@/lib/featureFlags")
import { createTransfer, deleteTransfer } from "../pettyCashTransfer"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`), decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/xferAccount", () => ({ getXferAccountId: jest.fn().mockResolvedValue(9) }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn().mockResolvedValue({ id: 2 }) }))
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn(), pettyCashTransfer: { findUnique: jest.fn() }, transaction: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) } } }))

import { auth } from "@/auth"
import { assertUnlocked } from "@/lib/accountingLock"
import { prisma } from "@/lib/prisma"
import { logAudit, logAuditTx } from "@/lib/audit"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
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
  const okLeg = { id: 11, type: "EXPENSE", accountId: 9, amount: { toFixed: () => "50.00" }, date: new Date("2026-07-31"), paymentAccountId: 2, pettyCashTransferId: null, reconciled: false }
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
    // Audit: transfer metadata carries the deposit + leg ids; leg gets TRANSACTION_UPDATED.
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "PETTY_CASH_TRANSFER_CREATED", "PettyCashTransfer", 3,
      expect.objectContaining({ importedTransactionId: 7, adoptedLegId: 11 }))
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "TRANSACTION_UPDATED", "Transaction", 11, expect.objectContaining({ action: "adopted-as-transfer-mirror" }))
  })

  it("does no writes when adoption validation fails", async () => {
    const base0 = base()
    const update = jest.fn()
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, reconciled: true })
    await run({ ...base0, transaction: { findUnique, update, create: jest.fn() } })
    expect(base0.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it("only sets the link when adopting (never touches reference)", async () => {
    const update = jest.fn()
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce(okLeg)
    await run({ ...base(), transaction: { findUnique, update, create: jest.fn() } })
    expect(update.mock.calls[0][0].data).toEqual({ pettyCashTransferId: 3 })
  })

  it("adopts a legacy leg with a null funding source and sets it to the cash account (#487)", async () => {
    const update = jest.fn().mockResolvedValue({})
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, paymentAccountId: null })
    await run({ ...base(), transaction: { findUnique, update, create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) } })
    expect(update.mock.calls[0][0].data).toEqual({ pettyCashTransferId: 3, paymentAccountId: 2 })
  })

  it("rejects adopting a legacy null-funding leg when a manual PC_T_ mirror already exists", async () => {
    const base0 = base()
    const update = jest.fn()
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, paymentAccountId: null })
    const findFirst = jest.fn().mockResolvedValue({ pettyCashTransferId: 5 })
    await expect(run({ ...base0, transaction: { findUnique, update, create: jest.fn(), findFirst } }))
      .resolves.toEqual({ error: expect.stringContaining("#5") })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ bankRef: { startsWith: "PC_T_" } }) }))
    expect(base0.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
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

  it("rejects an invalid (non-positive) imported id before any transaction", async () => {
    const fd = form()
    fd.set("importedTransactionId", "0")
    await expect(createTransfer(1, undefined, fd)).resolves.toEqual({ error: "Invalid imported deposit" })
    fd.set("importedTransactionId", "99999999999")
    await expect(createTransfer(1, undefined, fd)).resolves.toEqual({ error: "Invalid imported deposit" })
    for (const bad of ["0x10", "1e1", " 12 "]) {
      fd.set("importedTransactionId", bad)
      await expect(createTransfer(1, undefined, fd)).resolves.toEqual({ error: "Invalid imported deposit" })
    }
  })

  it("rejects when the leg falls on a different day than the transfer", async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, date: new Date("2026-07-30") })
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Imported deposit's cash-out date does not match this transfer" })
  })

  it("checks the lock once, before the transaction (leg is on the transfer day)", async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce(okLeg)
    await run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } })
    expect(assertUnlocked).toHaveBeenCalledTimes(1)
  })

  it("rejects an already-reconciled leg", async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, reconciled: true })
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Imported deposit's cash-out is already reconciled" })
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
  rejects("rejects a leg on the wrong payment account", deposit, { ...okLeg, paymentAccountId: 99 }, "Imported deposit's cash-out entry does not match this transfer")
})

describe("createTransfer — manual path duplicate guard", () => {
  // legs = XFER_OUT cash-out legs (linked or not); dup = their paired INCOME deposit (null = none).
  const txMock = (dup: unknown, legs: unknown[] = dup ? [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null }] : []) => ({
    pettyCashSession: { findUnique: jest.fn().mockResolvedValue({ status: "OPEN", title: "S", openingBalance: 100, receipts: [], expenses: [], transfers: [] }) },
    pettyCashTransfer: { create: jest.fn().mockResolvedValue({ id: 3, date: new Date("2026-07-31"), amount: "50.00" }) },
    transaction: {
      // Leg lookup (EXPENSE) honours a `reconciled` filter like the DB would: any reconciled:false
      // filter in the guard would hide a reconciled leg. Deposit lookup (INCOME) returns the dup.
      findMany: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.type === "INCOME"
          ? (dup ? [{ bankRef: "B1" }] : [])
          : legs.filter((l) => !("reconciled" in where) || (l as { reconciled?: boolean }).reconciled === where.reconciled)),
      create: jest.fn(),
    },
  })

  // Regression (#471): a second cash-out for an already-imported deposit double-counted petty cash.
  it("rejects a manual transfer that would double-count an imported cash-out (same amount and day, paired deposit)", async () => {
    const tx = txMock({ id: 11 })
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("un-reconcile") })
    expect(res).toEqual({ error: expect.stringContaining("imported cash-out") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    const call = tx.transaction.findMany.mock.calls[0][0]
    expect(call.where).toEqual(expect.objectContaining({ amount: "50.00", accountId: 9 }))
    // Reconciled legs must still be matched (the error tells the user to un-reconcile).
    expect(call.where).not.toHaveProperty("reconciled")
    // Adopted (linked) legs must be matched too (#492).
    expect(call.where).not.toHaveProperty("pettyCashTransferId")
    // Legacy legs with a null funding source still count (#487).
    expect(call.where.OR).toEqual([{ paymentAccountId: null }, { paymentAccountId: 2 }])
    // Same-day bound: [00:00Z of the transfer day, +24h) on both the leg and deposit lookups.
    const dayBound = { gte: expect.any(Date), lt: expect.any(Date) }
    expect(call.where.date).toEqual(dayBound)
    expect(call.where.date.lt.getTime() - call.where.date.gte.getTime()).toBe(86_400_000)
    expect(tx.transaction.findMany.mock.calls[1][0].where).toEqual(
      expect.objectContaining({ type: "INCOME", amount: "50.00", date: dayBound })
    )
  })

  it("allows manual entry when the matching leg has no paired deposit to adopt", async () => {
    const tx = txMock(null, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null }])
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createTransfer(1, undefined, form())
    expect(tx.transaction.create).toHaveBeenCalled()
    // The deposit lookup was keyed on the leg's paired deposit ref, so "no dup" is a real negative.
    expect(tx.transaction.findMany.mock.calls[1][0].where.bankRef).toEqual({ in: ["B1"] })
  })

  it("rejects when the paired leg is already reconciled (user must un-reconcile first)", async () => {
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, reconciled: true }])
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("un-reconcile") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
  })

  // Regression (#492): the leg was already adopted by another transfer, so it is no longer unlinked.
  it("rejects a manual transfer for a deposit whose cash-out leg is already adopted by another transfer", async () => {
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: 7 }])
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("already recorded as a petty cash transfer") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
  })

  it("creates the mirror when no duplicate leg exists", async () => {
    const tx = txMock(null)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createTransfer(1, undefined, form())
    expect(tx.transaction.create).toHaveBeenCalledTimes(1)
    expect(tx.transaction.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ amount: "50.00", pettyCashTransferId: 3 })
    )
  })
})

describe("deleteTransfer — adopted leg", () => {
  const findTransfer = prisma.pettyCashTransfer.findUnique as jest.Mock
  const old = new Date("2015-01-01")
  function setup(mirror: { reconciled: boolean; bankRef: string | null }) {
    findTransfer.mockResolvedValue({
      id: 5, date: old, amount: 50, sessionId: 1,
      session: { id: 1, status: "OPEN" },
      transaction: { id: 11, reconciled: false }, // stale pre-read: not adopted
    })
    const update = jest.fn()
    const tx = {
      pettyCashSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      transaction: { findUnique: jest.fn().mockResolvedValue(mirror), update },
      pettyCashTransfer: { findUnique: jest.fn().mockResolvedValue({ id: 5 }), delete: jest.fn() },
    }
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    return update
  }

  it("derives adopted from the in-tx mirror read, unlinks (link only) and audits", async () => {
    const update = setup({ reconciled: false, bankRef: "XFER_OUT_ANZ_1" })
    await deleteTransfer(5)
    expect(update).toHaveBeenCalledWith({ where: { id: 11 }, data: { pettyCashTransferId: null } })
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "TRANSACTION_UPDATED", "Transaction", 11, expect.objectContaining({ action: "unlinked-from-transfer" }))
    expect(logAudit).not.toHaveBeenCalledWith(1, "TRANSACTION_DELETED", "Transaction", 11, expect.anything())
  })

  it("treats a normal mirror as not adopted (cascade delete audited)", async () => {
    const update = setup({ reconciled: false, bankRef: "PC_T_5" })
    await deleteTransfer(5)
    expect(update).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(1, "TRANSACTION_DELETED", "Transaction", 11, expect.any(Object))
  })
})

describe("createTransfer — submission token replay (#491)", () => {
  const TOKEN = "11111111-2222-4333-8444-555555555555"
  const tokenForm = () => {
    const fd = form()
    fd.set("submissionToken", TOKEN)
    return fd
  }
  const same = { id: 3, sessionId: 1, amount: { toString: () => "50.00" }, date: new Date("2026-07-31"), retainedFloat: { toString: () => "0" }, depositSlipRef: null, depositedByName: "enc:Treasurer", notes: null }
  const txMock = (prior: unknown) => ({
    pettyCashTransfer: {
      findUnique: jest.fn().mockResolvedValue(prior),
      create: jest.fn().mockResolvedValue({ id: 3, date: new Date("2026-07-31"), amount: "50.00" }),
    },
    pettyCashSession: { findUnique: jest.fn().mockResolvedValue({ status: "OPEN", title: "S", openingBalance: 100, receipts: [], expenses: [], transfers: [] }) },
    transaction: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
  })

  it("stores the token on a first submit", async () => {
    const tx = txMock(null)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createTransfer(1, undefined, tokenForm())
    expect(tx.pettyCashTransfer.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { submissionToken: TOKEN } }))
    expect(tx.pettyCashTransfer.create.mock.calls[0][0].data.submissionToken).toBe(TOKEN)
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a replayed token redirects to the session without creating a second transfer", async () => {
    const tx = txMock(same)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toBeUndefined()
    expect(revalidatePath).toHaveBeenCalled()
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
    // Replay runs before the balance check (the first attempt already reduced it).
    expect(tx.pettyCashSession.findUnique).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a P2002 from a concurrent submit of the same token is treated as done", async () => {
    mock$tx.mockRejectedValue({ code: "P2002" })
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockResolvedValue(same)
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toBeUndefined()
    expect(prisma.pettyCashTransfer.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { submissionToken: TOKEN } }))
    expect(revalidatePath).toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a double-click race surfacing as P2034 redirects once the winner committed the same transfer", async () => {
    mock$tx.mockRejectedValue({ code: "P2034" })
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockResolvedValue(same)
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toBeUndefined()
    expect(revalidatePath).toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a P2034 whose winner commits just after the first read is re-read and treated as done", async () => {
    mock$tx.mockRejectedValue({ code: "P2034" })
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(same)
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toBeUndefined()
    expect(prisma.pettyCashTransfer.findUnique).toHaveBeenCalledTimes(2)
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it.each([
    ["depositedByName", { ...same, depositedByName: "enc:Other" }],
    ["notes", { ...same, notes: "enc:changed" }],
    ["retainedFloat", { ...same, retainedFloat: { toString: () => "5.00" } }],
    ["depositSlipRef", { ...same, depositSlipRef: "SLIP9" }],
  ])("a reused token with an edited %s is rejected, not faked as success", async (_l, prior) => {
    const tx = txMock(prior)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toEqual({ error: expect.stringContaining("already submitted") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
  })

  it("a reused token for an adopted transfer submitted manually is rejected", async () => {
    const tx = txMock(same)
    tx.transaction.findFirst.mockResolvedValue({ bankRef: "XFER_OUT:abc" })
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toEqual({ error: expect.stringContaining("already submitted") })
  })

  it("a P2034 with an unused token still shows the retry prompt", async () => {
    mock$tx.mockRejectedValue({ code: "P2034" })
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockResolvedValue(null)
    await expect(createTransfer(1, undefined, tokenForm())).resolves.toEqual({ error: "Transfer conflict — please try again." })
    expect(redirect).not.toHaveBeenCalled()
  })

  it.each([
    ["amount", { ...same, amount: { toString: () => "60.00" } }],
    ["date", { ...same, date: new Date("2026-07-30") }],
    ["session", { ...same, sessionId: 2 }],
  ])("a token reused for a different transfer (%s differs) is rejected, not dropped", async (_l, prior) => {
    const tx = txMock(prior)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toEqual({ error: expect.stringContaining("already submitted") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("rethrows a P2002 that is not the token (no transfer carries it)", async () => {
    const err = { code: "P2002" }
    mock$tx.mockRejectedValue(err)
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockResolvedValue(null)
    await expect(createTransfer(1, undefined, tokenForm())).rejects.toBe(err)
    expect(redirect).not.toHaveBeenCalled()
  })

  it("rethrows a P2002 when the form carried no token", async () => {
    const err = { code: "P2002" }
    mock$tx.mockRejectedValue(err)
    await expect(createTransfer(1, undefined, form())).rejects.toBe(err)
    expect(prisma.pettyCashTransfer.findUnique).not.toHaveBeenCalled()
  })
})
