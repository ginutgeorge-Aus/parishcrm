import {
  fromSentinel,
  idToStringOrEmpty,
  findDefaultBankAccountId,
  initialPaymentAccountId,
  initialFundId,
  deriveTransactionType,
  formatUpdatedAt,
  submitLabel,
} from "@/lib/transactionFormHelpers"
import { AccountType, TransactionType } from "@/lib/generated/prisma/enums"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"

test("fromSentinel maps the sentinel to empty string, passes other values through", () => {
  expect(fromSentinel("NONE")).toBe("")
  expect(fromSentinel("42")).toBe("42")
  expect(fromSentinel("CUSTOM", "CUSTOM")).toBe("")
})

test("idToStringOrEmpty stringifies truthy ids, falsy values become empty string", () => {
  expect(idToStringOrEmpty(7)).toBe("7")
  expect(idToStringOrEmpty(0)).toBe("")
  expect(idToStringOrEmpty(null)).toBe("")
  expect(idToStringOrEmpty(undefined)).toBe("")
})

test("findDefaultBankAccountId picks the active default BANK account", () => {
  const accounts: PaymentAccountLite[] = [
    { id: 1, name: "Cash", kind: "CASH", isDefault: true, isActive: true },
    { id: 2, name: "Old Bank", kind: "BANK", isDefault: true, isActive: false },
    { id: 3, name: "Main Bank", kind: "BANK", isDefault: true, isActive: true },
  ]
  expect(findDefaultBankAccountId(accounts)).toBe(3)
  expect(findDefaultBankAccountId([])).toBeUndefined()
})

test("initialPaymentAccountId prefers the transaction's own id, else the default bank account", () => {
  expect(initialPaymentAccountId(5, 9)).toBe("5")
  expect(initialPaymentAccountId(null, 9)).toBe("9")
  expect(initialPaymentAccountId(undefined, undefined)).toBe("")
})

test("initialFundId: editing keeps the row's own fundId (incl. null), new defaults to General", () => {
  expect(initialFundId(true, 4, 1)).toBe("4")
  expect(initialFundId(true, null, 1)).toBe("")
  expect(initialFundId(false, 4, 1)).toBe("1")
  expect(initialFundId(false, 4, undefined)).toBe("")
})

test("deriveTransactionType follows the selected account, else falls back", () => {
  expect(deriveTransactionType(AccountType.INCOME, undefined)).toBe(TransactionType.INCOME)
  expect(deriveTransactionType(AccountType.EXPENSE, undefined)).toBe(TransactionType.EXPENSE)
  expect(deriveTransactionType(undefined, TransactionType.EXPENSE)).toBe(TransactionType.EXPENSE)
  expect(deriveTransactionType(undefined, undefined)).toBe(TransactionType.INCOME)
})

test("formatUpdatedAt passes strings through, ISO-formats Dates", () => {
  expect(formatUpdatedAt("2024-01-01T00:00:00.000Z")).toBe("2024-01-01T00:00:00.000Z")
  const d = new Date("2024-01-01T00:00:00.000Z")
  expect(formatUpdatedAt(d)).toBe(d.toISOString())
})

test("submitLabel reflects pending/edit state", () => {
  expect(submitLabel(true, true)).toBe("Saving…")
  expect(submitLabel(true, false)).toBe("Saving…")
  expect(submitLabel(false, true)).toBe("Save changes")
  expect(submitLabel(false, false)).toBe("Create transaction")
})
