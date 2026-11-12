import { render, screen } from "@testing-library/react"
import { EntryTable } from "@/components/events/fundraiser/EntryTable"
import type { FundraiserRow } from "@/lib/fundraiserQueries"

jest.mock("@/lib/actions/fundraiser", () => ({
  updateEntryQuantity: jest.fn(),
  deleteEntry: jest.fn(),
  recordPayment: jest.fn(),
  deletePayment: jest.fn(),
}))

const base = { familyId: null, quantity: 2, bankRef: "REF1", hasEmail: false }
const rows: FundraiserRow[] = [
  { ...base, id: 1, name: "Anna", owedCents: 2000, paidCents: 0, remainingCents: 2000, status: "UNPAID" },
  { ...base, id: 2, name: "Ben", owedCents: 2000, paidCents: 500, remainingCents: 1500, status: "PART" },
  { ...base, id: 3, name: "Cara", owedCents: 2000, paidCents: 2000, remainingCents: 0, status: "PAID" },
  { ...base, id: 4, name: "Dan", owedCents: 2000, paidCents: 3000, remainingCents: 0, status: "OVERPAID" },
]

test("renders status labels from props", () => {
  render(<EntryTable rows={rows} unitPrice="10.00" canManage={false} payments={{}} />)
  for (const label of ["Unpaid", "Part paid", "Paid", "Overpaid"]) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
})

test("hides action buttons when canManage=false", () => {
  render(<EntryTable rows={rows} unitPrice="10.00" canManage={false} payments={{}} />)
  expect(screen.queryByRole("button", { name: /payments/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
})

test("shows action buttons when canManage=true", () => {
  render(<EntryTable rows={rows} unitPrice="10.00" canManage payments={{}} />)
  expect(screen.getAllByRole("button", { name: /payments/i }).length).toBeGreaterThan(0)
  expect(screen.getAllByRole("button", { name: /delete/i }).length).toBeGreaterThan(0)
})
