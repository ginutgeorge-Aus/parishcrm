import { render, screen, fireEvent } from "@testing-library/react"
import { BalanceSheetDatePicker } from "@/components/accounting/BalanceSheetDatePicker"

const mockPush = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(() => mockPush.mockClear())

describe("BalanceSheetDatePicker", () => {
  it("renders date input with provided value", () => {
    render(<BalanceSheetDatePicker value="2026-05-29" />)
    expect(screen.getByLabelText("Balance sheet date")).toBeInTheDocument()
  })

  it("pushes date param to URL on change", () => {
    render(<BalanceSheetDatePicker value="2026-05-29" />)
    fireEvent.change(screen.getByLabelText("Balance sheet date"), {
      target: { value: "2026-01-01" },
    })
    expect(mockPush).toHaveBeenCalledWith(
      "/accounting/reports/balance-sheet?date=2026-01-01"
    )
  })

  it("removes date param when value cleared", () => {
    render(<BalanceSheetDatePicker value="2026-05-29" />)
    fireEvent.change(screen.getByLabelText("Balance sheet date"), {
      target: { value: "" },
    })
    expect(mockPush).toHaveBeenCalledWith("/accounting/reports/balance-sheet")
  })
})
