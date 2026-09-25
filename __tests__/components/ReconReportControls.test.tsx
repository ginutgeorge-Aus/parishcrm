import { render, screen, fireEvent } from "@testing-library/react"
import { ReconReportControls } from "@/components/accounting/ReconReportControls"

// Render the shadcn Select as a plain native <select> — this test drives
// ReconReportControls' URL-push logic, not Radix internals (same pattern as
// petty-cash-ImportClient.test.tsx).
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value ?? ""} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => (placeholder ? <option value="">{placeholder}</option> : null),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

const mockPush = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

const accounts = [
  { id: 1, name: "ANZ Church", kind: "BANK" as const, isDefault: true, isActive: true },
  { id: 2, name: "ANZ Tithe", kind: "BANK" as const, isDefault: false, isActive: true },
  { id: 3, name: "Petty Cash", kind: "CASH" as const, isDefault: false, isActive: true },
]

beforeEach(() => mockPush.mockClear())

describe("ReconReportControls", () => {
  it("renders account select with current value", () => {
    render(<ReconReportControls accounts={accounts} paymentAccountId={1} statementDate="2026-06-30" />)
    expect(screen.getByRole("combobox")).toHaveValue("1")
  })

  it("renders all three account options", () => {
    render(<ReconReportControls accounts={accounts} paymentAccountId={1} statementDate="2026-06-30" />)
    expect(screen.getByText("ANZ Church")).toBeInTheDocument()
    expect(screen.getByText("ANZ Tithe")).toBeInTheDocument()
    expect(screen.getByText("Petty Cash")).toBeInTheDocument()
  })

  it("renders date input with current value", () => {
    render(<ReconReportControls accounts={accounts} paymentAccountId={1} statementDate="2026-06-30" />)
    expect(screen.getByDisplayValue("2026-06-30")).toBeInTheDocument()
  })

  it("pushes correct URL on account change", () => {
    render(<ReconReportControls accounts={accounts} paymentAccountId={1} statementDate="2026-06-30" />)
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } })
    expect(mockPush).toHaveBeenCalledWith(
      "/accounting/reports/reconciliation?paymentAccount=2&statementDate=2026-06-30"
    )
  })

  it("pushes correct URL on date change", () => {
    render(<ReconReportControls accounts={accounts} paymentAccountId={1} statementDate="2026-06-30" />)
    fireEvent.change(screen.getByDisplayValue("2026-06-30"), {
      target: { value: "2026-05-31" },
    })
    expect(mockPush).toHaveBeenCalledWith(
      "/accounting/reports/reconciliation?paymentAccount=1&statementDate=2026-05-31"
    )
  })

  it("renders print button", () => {
    render(<ReconReportControls accounts={accounts} paymentAccountId={1} statementDate="2026-06-30" />)
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument()
  })
})
