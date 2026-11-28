/** @jest-environment node */
// AUD-3-19: untrusted ids/dates reaching accounting actions are rejected before any DB access.

jest.mock("@/lib/featureFlags")
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/accountingLock", () => ({
  assertUnlockedTx: jest.fn(async () => null),
  assertUnlocked: jest.fn().mockResolvedValue(null),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const model = () => new Proxy({}, { get: () => jest.fn() })
  return { prisma: new Proxy({}, { get: (_t, k) => (k === "$transaction" ? jest.fn() : model()) }) }
})

import { auth } from "@/auth"
import { createTransaction, updateTransaction, deleteTransaction } from "../transaction"
import { toggleReconciled, reconcileMany } from "../transactionReconcile"
import { renamePaymentAccount, setDefaultAccount, setAccountActive } from "../paymentAccount"
import { updateSessionCustodian, closeSession, createSession } from "../pettyCashSession"
import { updateExpense, deleteExpense, createExpense } from "../pettyCashExpense"
import { updateReceipt, deleteReceipt, createReceipt } from "../pettyCashReceipt"
import { deleteTransfer, createTransfer } from "../pettyCashTransfer"
import { pgIdFormField, optionalPgIdFormField, dateOnlyFormField } from "@/lib/formFieldSchemas"

const mockAuth = auth as jest.Mock
const BAD_IDS = [0, -1, 1.5, Number.NaN, 2147483648]

function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
})

describe("id arguments are rejected before any DB read", () => {
  it.each(BAD_IDS)("single-id actions reject %p", async (bad) => {
    const prev = undefined as never
    const results = await Promise.all([
      updateTransaction(bad, prev, fd({})),
      deleteTransaction(bad),
      toggleReconciled(bad, 1),
      toggleReconciled(1, bad),
      reconcileMany([1], bad),
      renamePaymentAccount(bad, prev, fd({ name: "x" })),
      setDefaultAccount(bad),
      setAccountActive(bad, true),
      updateSessionCustodian(bad, prev, fd({ custodianId: "1" })),
      closeSession(bad, prev, fd({})),
      updateExpense(bad, prev, fd({})),
      deleteExpense(bad),
      updateReceipt(bad, prev, fd({})),
      deleteReceipt(bad),
      deleteTransfer(bad),
    ])
    for (const r of results) expect(r).toEqual({ error: expect.any(String) })
  })

  it("reconcileMany rejects an id above int4", async () => {
    expect(await reconcileMany([2147483648], 1)).toEqual({ error: "Invalid selection" })
  })
})

describe("createTransaction rejects malformed ids and dates", () => {
  const base = {
    date: "2026-03-01", description: "d", accountId: "1", type: "INCOME", amount: "10.00", paymentAccountId: "1",
  }
  const prev = undefined as never

  it.each([
    ["accountId", "abc", "Category is required"],
    ["accountId", "1e1", "Category is required"],
    ["paymentAccountId", "2147483648", "Invalid payment account"],
    ["paymentAccountId", "0", "Invalid payment account"],
    ["familyId", "0x10", "Invalid family"],
    ["personId", "-3", "Invalid person"],
    ["fundId", "99999999999", "Invalid fund"],
    ["date", "2026-02-30", "Invalid date"],
    ["date", "foo", "Invalid date"],
    ["date", "9999-01-01", "Invalid date"],
    ["date", "1999-12-31", "Invalid date"],
  ])("%s=%p -> %s", async (field, value, message) => {
    const r = await createTransaction(prev, fd({ ...base, [field]: value }))
    expect(r).toEqual({ error: message })
  })
})

describe("petty cash schemas reject malformed ids and dates", () => {
  const prev = undefined as never
  const exp = { payee: "p", accountId: "1", amount: "5.00", description: "d" }
  const rec = { accountId: "1", amount: "5.00" }

  it("createSession rejects a non-numeric / out-of-range custodian", async () => {
    for (const custodianId of ["abc", "0", "2147483648"]) {
      const r = await createSession(prev, fd({ sessionDate: "2026-03-01", custodianId }))
      expect(r).toEqual({ error: "Custodian is required" })
    }
  })

  it("createExpense rejects bad accountId and fundId", async () => {
    expect(await createExpense(1, prev, fd({ ...exp, accountId: "1e1" }))).toEqual({ error: "Select a category" })
    expect(await createExpense(1, prev, fd({ ...exp, accountId: "abc" }))).toEqual({ error: "Select a category" })
    expect(await createExpense(1, prev, fd({ ...exp, fundId: "-2" }))).toEqual({ error: "Invalid fund" })
  })

  it("createReceipt rejects bad accountId, donor, service type and fund", async () => {
    expect(await createReceipt(1, prev, fd({ ...rec, accountId: "0" }))).toEqual({ error: "Select a category" })
    expect(await createReceipt(1, prev, fd({ ...rec, personId: "x" }))).toEqual({ error: "Invalid donor" })
    expect(await createReceipt(1, prev, fd({ ...rec, serviceTypeId: "1.5" }))).toEqual({ error: "Invalid service type" })
    expect(await createReceipt(1, prev, fd({ ...rec, fundId: "2147483648" }))).toEqual({ error: "Invalid fund" })
  })

  it("createTransfer rejects a malformed or out-of-range date", async () => {
    for (const date of ["2026-02-30", "garbage", "9999-01-01"]) {
      const r = await createTransfer(1, prev, fd({ date, amount: "5.00", depositedByName: "n" }))
      expect(r).toEqual({ error: "Invalid date" })
    }
  })
})

describe("formFieldSchemas", () => {
  it("pgIdFormField accepts digits within int4 only", () => {
    const s = pgIdFormField("bad")
    expect(s.parse(" 12 ")).toBe(12)
    for (const v of ["", "0", "-1", "1.5", "1e1", "0x10", "2147483648"]) expect(s.safeParse(v).success).toBe(false)
    expect(s.safeParse(undefined).success).toBe(false)
  })

  it("optionalPgIdFormField maps blank to the empty value and rejects junk", () => {
    expect(optionalPgIdFormField("bad", null).parse("")).toBeNull()
    expect(optionalPgIdFormField("bad", undefined).parse(undefined)).toBeUndefined()
    expect(optionalPgIdFormField("bad", null).parse("7")).toBe(7)
    expect(optionalPgIdFormField("bad", null).safeParse("7x").success).toBe(false)
  })

  it("dateOnlyFormField accepts real dates in range and an ISO time suffix", () => {
    const s = dateOnlyFormField()
    expect(s.parse("2026-03-01").toISOString()).toBe("2026-03-01T00:00:00.000Z")
    expect(s.safeParse("2026-03-01T10:00:00Z").success).toBe(true)
    for (const v of ["", "2026-13-01", "2026-02-30", "2026-03-01x", "1999-01-01", "2101-01-01"]) {
      expect(s.safeParse(v).success).toBe(false)
    }
  })
})
