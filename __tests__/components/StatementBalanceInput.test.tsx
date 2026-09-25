import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { StatementBalanceInput } from "@/components/accounting/StatementBalanceInput"

jest.mock("@/lib/actions/reconciliation", () => ({
  saveStatementBalance: jest.fn(),
}))

import { saveStatementBalance } from "@/lib/actions/reconciliation"
const mockSave = saveStatementBalance as jest.Mock

beforeEach(() => jest.clearAllMocks())

const baseProps = {
  paymentAccountId: 1,
  statementDate: "2026-05-31",
  calculatedBalance: 12820,
  canEdit: true,
}

describe("StatementBalanceInput", () => {
  it("renders input and Save button when canEdit=true", () => {
    render(<StatementBalanceInput {...baseProps} initialValue={null} />)
    expect(screen.getByLabelText("Statement closing balance")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument()
  })

  it("shows the statement date the balance is recorded against", () => {
    render(<StatementBalanceInput {...baseProps} initialValue={null} />)
    expect(screen.getByText("as of 31 May 2026")).toBeInTheDocument()
  })

  it("abbreviates the month in the statement date", () => {
    render(<StatementBalanceInput {...baseProps} statementDate="2026-01-05" initialValue={null} />)
    expect(screen.getByText("as of 5 Jan 2026")).toBeInTheDocument()
  })

  it("falls back to the raw string for an overflowing day", () => {
    render(<StatementBalanceInput {...baseProps} statementDate="2026-02-31" initialValue={null} />)
    expect(screen.getByText("as of 2026-02-31")).toBeInTheDocument()
  })

  it("shows the statement date in read-only mode too", () => {
    render(<StatementBalanceInput {...baseProps} initialValue="12820.00" canEdit={false} />)
    expect(screen.getByText("as of 31 May 2026")).toBeInTheDocument()
  })

  it("pre-fills input with initialValue", () => {
    render(<StatementBalanceInput {...baseProps} initialValue="12820.00" />)
    expect(screen.getByLabelText("Statement closing balance")).toHaveValue("12820.00")
  })

  it("renders read-only text when canEdit=false", () => {
    render(<StatementBalanceInput {...baseProps} initialValue="12820.00" canEdit={false} />)
    expect(screen.queryByLabelText("Statement closing balance")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
    expect(screen.getByText("$12,820.00")).toBeInTheDocument()
  })

  it("shows — when canEdit=false and no initialValue", () => {
    render(<StatementBalanceInput {...baseProps} initialValue={null} canEdit={false} />)
    expect(screen.getByText("—")).toBeInTheDocument()
  })

  it("shows difference as user types", () => {
    render(<StatementBalanceInput {...baseProps} initialValue={null} />)
    fireEvent.change(screen.getByLabelText("Statement closing balance"), {
      target: { value: "12000" },
    })
    // calculated (12820) - statement (12000) = 820 out of balance
    expect(screen.getByText(/820/)).toBeInTheDocument()
  })

  it("shows $0.00 ✓ when balanced", () => {
    render(<StatementBalanceInput {...baseProps} initialValue={null} />)
    fireEvent.change(screen.getByLabelText("Statement closing balance"), {
      target: { value: "12820" },
    })
    expect(screen.getByText("$0.00 ✓")).toBeInTheDocument()
  })

  it("hides difference row when input is empty", () => {
    render(<StatementBalanceInput {...baseProps} initialValue={null} />)
    expect(screen.queryByText(/✓/)).not.toBeInTheDocument()
    expect(screen.queryByText(/out of balance/)).not.toBeInTheDocument()
  })

  it("calls saveStatementBalance with correct args on Save click", async () => {
    mockSave.mockResolvedValue({ success: "Saved" })
    render(<StatementBalanceInput {...baseProps} initialValue={null} />)
    fireEvent.change(screen.getByLabelText("Statement closing balance"), {
      target: { value: "12820.00" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(1, "2026-05-31", "12820.00")
    )
  })

  it("shows error message when save fails", async () => {
    mockSave.mockResolvedValue({ error: "Failed to save" })
    render(<StatementBalanceInput {...baseProps} initialValue={null} />)
    fireEvent.change(screen.getByLabelText("Statement closing balance"), {
      target: { value: "12820.00" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.getByText("Failed to save")).toBeInTheDocument())
  })

  it("Save button is disabled when input is empty", () => {
    render(<StatementBalanceInput {...baseProps} initialValue={null} />)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })
})
