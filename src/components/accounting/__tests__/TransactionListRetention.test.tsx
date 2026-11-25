import { render, screen } from "@testing-library/react"
import { TransactionTable } from "@/components/accounting/TransactionTable"
import { TransactionMobileList } from "@/components/accounting/TransactionMobileList"
import type { TransactionRow } from "@/lib/reports/transactionsQuery"

jest.mock("@/components/accounting/DeleteTransactionButton", () => ({
  DeleteTransactionButton: ({ id }: { id: number }) => <button>Delete tx {id}</button>,
}))
jest.mock("@/components/accounting/ReconcileToggleButton", () => ({
  ReconcileToggleButton: () => <button>Reconcile</button>,
}))
jest.mock("@/components/accounting/RiskFlagBadges", () => ({ RiskFlagBadges: () => null }))
jest.mock("@/lib/accountingLock", () => ({ isDateLocked: () => false }))

const tx = (date: Date) =>
  ({
    id: 3,
    date,
    description: "Hall hire",
    amount: "50.00",
    type: "INCOME",
    reconciled: false,
    paymentAccountId: null,
    paymentAccountRel: null,
    family: null,
    account: { code: "4000", name: "Income" },
    pettyCashReceiptId: null,
    pettyCashExpenseId: null,
    pettyCashTransferId: null,
  }) as unknown as TransactionRow

const OLD = new Date("2010-07-31T00:00:00.000Z")

const common = { lockDate: null, userCanEdit: true, userIsAdmin: true, total: 1, income: 50, expense: 0, net: 50 }

describe.each([
  ["table", (d: Date) => <TransactionTable transactions={[tx(d)]} {...common} />],
  ["mobile list", (d: Date) => <TransactionMobileList transactions={[tx(d)]} {...common} />],
])("%s retention gate", (_name, ui) => {
  test("old transaction keeps Delete", () => {
    render(ui(OLD))
    expect(screen.getByText("Delete tx 3")).toBeInTheDocument()
    expect(screen.queryByText(/Kept for 7 years/)).not.toBeInTheDocument()
  })

  test("transaction inside 7 years swaps Delete for the explanatory note", () => {
    render(ui(new Date()))
    expect(screen.queryByText("Delete tx 3")).not.toBeInTheDocument()
    expect(screen.getByText(/Kept for 7 years/)).toBeInTheDocument()
  })
})
