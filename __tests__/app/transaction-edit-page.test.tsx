/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findUnique: jest.fn() },
    account: { findMany: jest.fn().mockResolvedValue([]) },
    family: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))
jest.mock("@/lib/actions/fund", () => ({ getActiveFunds: jest.fn().mockResolvedValue([]) }))
jest.mock("@/lib/paymentAccounts", () => ({ getPaymentAccounts: jest.fn().mockResolvedValue([]) }))
jest.mock("@/lib/actions/transaction", () => ({ updateTransaction: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/accountingLock", () => ({
  getAccountingLockDate: jest.fn(),
  isDateLocked: jest.fn(),
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))

// Capture the props the page hands to the form.
let capturedProps: { transaction?: { description?: string } } = {}
jest.mock("@/components/accounting/TransactionForm", () => ({
  TransactionForm: (props: { transaction?: { description?: string } }) => {
    capturedProps = props
    return null
  },
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isDateLocked, getAccountingLockDate } from "@/lib/accountingLock"
import EditTransactionPage from "@/app/(dashboard)/accounting/transactions/[id]/edit/page"

const mockAuth = auth as jest.Mock
const mockFindUnique = prisma.transaction.findUnique as jest.Mock
const mockIsDateLocked = isDateLocked as jest.Mock
const mockLockDate = getAccountingLockDate as jest.Mock

const baseTx = {
  id: 5, date: new Date("2026-07-01"), description: "enc:Tithe July", amount: { toString: () => "50" },
  type: "INCOME", accountId: 1, paymentAccount: null, familyId: null, personId: null,
  reference: null, notes: null, reconciled: false,
  pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null,
  pettyCashReceipt: null, pettyCashExpense: null, pettyCashTransfer: null,
}

const props = { params: Promise.resolve({ id: "5" }) }

beforeEach(() => {
  jest.clearAllMocks()
  capturedProps = {}
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  mockLockDate.mockResolvedValue(null)
  mockIsDateLocked.mockReturnValue(false)
})

test("decrypts the transaction description before passing it to the form", async () => {
  mockFindUnique.mockResolvedValue(baseTx)
  renderToStaticMarkup(await EditTransactionPage(props))
  expect(capturedProps.transaction?.description).toBe("Tithe July")
})

test("redirects locked-period transactions to the read-only detail page", async () => {
  mockFindUnique.mockResolvedValue(baseTx)
  mockIsDateLocked.mockReturnValue(true)
  await expect(EditTransactionPage(props)).rejects.toThrow("REDIRECT:/accounting/transactions/5")
})
