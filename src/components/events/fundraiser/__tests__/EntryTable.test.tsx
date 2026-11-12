import { render, screen } from "@testing-library/react"
import { EntryTable } from "@/components/events/fundraiser/EntryTable"
import type { FundraiserRow } from "@/lib/fundraiserQueries"

jest.mock("@/lib/actions/fundraiser", () => ({
  updateEntryQuantity: jest.fn(),
  deleteEntry: jest.fn(),
  recordPayment: jest.fn(),
  deletePayment: jest.fn(),
}))

const base = { familyId: null, quantity: 2, unitPrice: "10.00", bankRef: "REF1", hasEmail: false }
const rows: FundraiserRow[] = [
  { ...base, id: 1, name: "Anna", owedCents: 2000, paidCents: 0, remainingCents: 2000, status: "UNPAID" },
  { ...base, id: 2, name: "Ben", owedCents: 2000, paidCents: 500, remainingCents: 1500, status: "PART" },
  { ...base, id: 3, name: "Cara", owedCents: 2000, paidCents: 2000, remainingCents: 0, status: "PAID" },
  { ...base, id: 4, name: "Dan", owedCents: 2000, paidCents: 3000, remainingCents: 0, status: "OVERPAID" },
]

test("renders status labels from props", () => {
  render(<EntryTable rows={rows} canManage={false} payments={{}} />)
  for (const label of ["Unpaid", "Part paid", "Paid", "Overpaid"]) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
})

test("hides action buttons when canManage=false", () => {
  render(<EntryTable rows={rows} canManage={false} payments={{}} />)
  expect(screen.queryByRole("button", { name: /payments/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
})

test("shows action buttons when canManage=true", () => {
  render(<EntryTable rows={rows} canManage payments={{}} />)
  expect(screen.getAllByRole("button", { name: /payments/i }).length).toBeGreaterThan(0)
  expect(screen.getAllByRole("button", { name: /delete/i }).length).toBeGreaterThan(0)
})

test("each row shows its own snapshot price", () => {
  const two: FundraiserRow[] = [
    { ...base, id: 1, name: "Old", unitPrice: "10.00", owedCents: 2000, paidCents: 0, remainingCents: 2000, status: "UNPAID" },
    { ...base, id: 2, name: "New", unitPrice: "12.50", owedCents: 2500, paidCents: 0, remainingCents: 2500, status: "UNPAID" },
  ]
  render(<EntryTable rows={two} canManage={false} payments={{}} />)
  expect(screen.getAllByText(/\$10\.00/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/\$12\.50/).length).toBeGreaterThan(0)
})
