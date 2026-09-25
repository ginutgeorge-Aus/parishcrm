import { commitImport } from "@/lib/actions/pettyCashImport"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
// Value import of `Prisma` in pettyCashImport.ts loads the real generated client
// (cuid2 init) — stub the namespace so the suite doesn't pull it in.
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
jest.mock("@/lib/accountingLock", () => ({
  getAccountingLockDate: jest.fn(async () => null),
  isDateLocked: jest.fn(() => false),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    account: { findMany: jest.fn() },
    person: { findMany: jest.fn(), findFirst: jest.fn() },
    pettyCashSession: { findMany: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
    pettyCashReceipt: { findMany: jest.fn(), createManyAndReturn: jest.fn() },
    pettyCashExpense: { findMany: jest.fn(), createManyAndReturn: jest.fn() },
    transaction: { createMany: jest.fn() },
    // Backs getCashAccount(), resolved once per import batch. findFirst null +
    // upsert = the self-heal path that provisions the canonical Petty
    // Cash account when a fresh install has none.
    paymentAccount: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 2, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true }),
    },
  },
}))

const mockAuth = auth as jest.Mock
const mockTransaction = prisma.$transaction as jest.Mock
const mockAccountFind = prisma.account.findMany as jest.Mock
const mockPersonFindMany = prisma.person.findMany as jest.Mock
const mockPersonFindFirst = prisma.person.findFirst as jest.Mock
const mockSessionFindMany = prisma.pettyCashSession.findMany as jest.Mock
const mockSessionUpdateMany = prisma.pettyCashSession.updateMany as jest.Mock
const mockReceiptFindMany = prisma.pettyCashReceipt.findMany as jest.Mock
const mockExpenseFindMany = prisma.pettyCashExpense.findMany as jest.Mock
const mockReceiptCreateMany = prisma.pettyCashReceipt.createManyAndReturn as jest.Mock
const mockExpenseCreateMany = prisma.pettyCashExpense.createManyAndReturn as jest.Mock
const mockTxCreateMany = prisma.transaction.createMany as jest.Mock

// One valid expense row dated 01/07/2026 → session title "01-JUL-2026"
// (sessionTitle() in pettyCashImport.ts, MONTH_ABBR uppercase).
const CSV = "date,type,account,payee_or_donor,amount,notes\n01/07/2026,expense,Office Supplies,Test Vendor,10.00,Test description\n"

function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
  mockAccountFind.mockResolvedValue([{ id: 1, name: "Office Supplies", type: "EXPENSE", isActive: true }])
  mockPersonFindMany.mockResolvedValue([])
  mockPersonFindFirst.mockResolvedValue({ id: 1 })
  mockReceiptFindMany.mockResolvedValue([])
  mockExpenseFindMany.mockResolvedValue([])
  // Pre-insert lock recheck — default to a winning match (still OPEN).
  mockSessionUpdateMany.mockResolvedValue({ count: 1 })
})

test("commitImport rejects a row whose date maps to a CLOSED session, and writes nothing", async () => {
  mockSessionFindMany.mockResolvedValue([{ id: 5, title: "01-JUL-2026", status: "CLOSED" }])

  const res = await commitImport(fd({ custodianId: "1", csv: CSV }))

  expect(res).toHaveProperty("error")
  expect((res as { error: string }).error).toMatch(/is closed/)
  expect(mockReceiptCreateMany).not.toHaveBeenCalled()
  expect(mockExpenseCreateMany).not.toHaveBeenCalled()
  expect(mockTxCreateMany).not.toHaveBeenCalled()
})

test("commitImport re-checks the session's lock status right before the batched insert — a concurrent close after the initial read is still caught", async () => {
  // The initial read sees the session OPEN...
  mockSessionFindMany.mockResolvedValue([{ id: 5, title: "01-JUL-2026", status: "OPEN" }])
  // ...but a concurrent closeSession commits before this transaction's
  // pre-insert recheck runs, so the conditional updateMany matches no row.
  mockSessionUpdateMany.mockResolvedValue({ count: 0 })

  const res = await commitImport(fd({ custodianId: "1", csv: CSV }))

  expect(res).toHaveProperty("error")
  expect((res as { error: string }).error).toMatch(/is closed/)
  expect(mockExpenseCreateMany).not.toHaveBeenCalled()
  expect(mockTxCreateMany).not.toHaveBeenCalled()
})
