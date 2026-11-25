import { render, screen } from "@testing-library/react"
import { SessionExpensesTable } from "@/components/petty-cash/SessionExpensesTable"
import { SessionReceiptsTable } from "@/components/petty-cash/SessionReceiptsTable"
import type { SessionExpense, SessionReceipt } from "@/app/(dashboard)/accounting/petty-cash/sessions/[id]/page.data"

jest.mock("@/components/petty-cash/DeleteExpenseButton", () => ({
  DeleteExpenseButton: ({ id }: { id: number }) => <button>Delete expense {id}</button>,
}))
jest.mock("@/components/petty-cash/DeleteReceiptButton", () => ({
  DeleteReceiptButton: ({ id }: { id: number }) => <button>Delete receipt {id}</button>,
}))
jest.mock("@/lib/accountingLock", () => ({ isDateLocked: () => false }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: (v: string) => v }))

const account = { code: "5000", name: "Supplies" }
const expense = (date: Date) =>
  ({ id: 7, date, amount: "10.00", payee: "Shop", description: "Pens", receiptRef: null, account }) as unknown as SessionExpense
const receipt = (date: Date) =>
  ({ id: 8, date, amount: "20.00", account, serviceType: null, person: null }) as unknown as SessionReceipt

const OLD = new Date("2010-07-31T00:00:00.000Z")

describe.each([
  ["expenses", "Delete expense 7", (d: Date) => (
    <SessionExpensesTable sessionId={1} expenses={[expense(d)]} totalExpenses={10} userCanEdit userIsAdmin isOpen lockDate={null} />
  )],
  ["receipts", "Delete receipt 8", (d: Date) => (
    <SessionReceiptsTable sessionId={1} receipts={[receipt(d)]} totalReceipts={20} userCanEdit userIsAdmin isOpen lockDate={null} />
  )],
])("%s retention gate", (_name, deleteLabel, ui) => {
  test("old record keeps Delete in mobile and desktop layouts", () => {
    render(ui(OLD))
    expect(screen.getAllByText(deleteLabel)).toHaveLength(2)
    expect(screen.queryByText(/Kept for 7 years/)).not.toBeInTheDocument()
  })

  test("record inside 7 years swaps Delete for the explanatory note", () => {
    render(ui(new Date()))
    expect(screen.queryByText(deleteLabel)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Kept for 7 years/)).toHaveLength(2)
  })
})
