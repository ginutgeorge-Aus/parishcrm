import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { StatementBalanceInput } from "@/components/accounting/StatementBalanceInput"
import { saveStatementBalance } from "@/lib/actions/reconciliation"

jest.mock("@/lib/actions/reconciliation", () => ({ saveStatementBalance: jest.fn() }))

const props = {
  paymentAccountId: 1,
  statementDate: "2026-06-30",
  initialValue: null,
  calculatedBalance: 1000,
  canEdit: true,
}

describe("StatementBalanceInput", () => {
  beforeEach(() => jest.clearAllMocks())

  it("treats a comma-typed balance as the full amount and keeps Save enabled", () => {
    render(<StatementBalanceInput {...props} />)
    fireEvent.change(screen.getByLabelText("Statement closing balance"), { target: { value: "1,000.00" } })
    expect(screen.getByText("$0.00 ✓")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
  })

  it("sends the normalised value to the save action", async () => {
    ;(saveStatementBalance as jest.Mock).mockResolvedValue({ success: "Balanced" })
    render(<StatementBalanceInput {...props} />)
    fireEvent.change(screen.getByLabelText("Statement closing balance"), { target: { value: "$1,000.00" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(saveStatementBalance).toHaveBeenCalledWith(1, "2026-06-30", "1000.00"))
  })

  it("shows a reason, no difference, and disables Save for invalid text", () => {
    render(<StatementBalanceInput {...props} />)
    const input = screen.getByLabelText("Statement closing balance")
    fireEvent.change(input, { target: { value: "abc" } })
    const hint = screen.getByText("Enter an amount such as 1000.00")
    expect(input).toHaveAttribute("aria-describedby", hint.id)
    expect(screen.queryByText(/out of balance/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("shows no hint for an empty field", () => {
    render(<StatementBalanceInput {...props} />)
    expect(screen.queryByText("Enter an amount such as 1000.00")).not.toBeInTheDocument()
  })
})
