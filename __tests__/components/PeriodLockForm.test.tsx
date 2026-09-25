import { render, screen } from "@testing-library/react"

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useActionState: (_action: unknown, initial: unknown) => [initial, jest.fn(), false],
}))

jest.mock("@/lib/actions/accountingSettings", () => ({
  setAccountingLockDate: jest.fn(),
}))

import { PeriodLockForm } from "@/components/accounting/PeriodLockForm"

it("pre-fills the current lock date", () => {
  render(<PeriodLockForm currentLockDate="2026-06-30" />)
  expect(screen.getByLabelText(/lock date/i)).toHaveValue("2026-06-30")
})

it("renders an empty field when no lock is set", () => {
  render(<PeriodLockForm currentLockDate={null} />)
  expect(screen.getByLabelText(/lock date/i)).toHaveValue("")
})
