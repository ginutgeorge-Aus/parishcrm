/**
 * @jest-environment jsdom
 *
 * missing component test. Covers BudgetForm's non-trivial UI logic —
 * year-range generation around the current FY, budget-map initialisation of
 * inputs, copy-from-previous-year action (success, empty, and failure paths),
 * year-navigation routing, and server-action error/success display.
 */
import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BudgetForm } from "@/components/accounting/BudgetForm"

// Render the shadcn Select as a plain native <select> — this test drives the
// year-range/navigation logic, not Radix internals (same pattern as
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

// useActionState calls upsertBudgets; getPrevYearBudgets drives the copy button.
jest.mock("@/lib/actions/budget", () => ({
  upsertBudgets: jest.fn(),
  getPrevYearBudgets: jest.fn(),
}))
import { getPrevYearBudgets } from "@/lib/actions/budget"

// Pin currentFYYear so the year-range assertions are deterministic.
jest.mock("@/lib/fiscalYear", () => ({
  currentFYYear: () => 2025,
}))

const mockPrev = getPrevYearBudgets as jest.Mock

const accounts = [
  { id: 1, code: "4000", name: "Offerings", type: "INCOME" as const },
  { id: 2, code: "5000", name: "Utilities", type: "EXPENSE" as const },
]

beforeEach(() => jest.clearAllMocks())

describe("BudgetForm", () => {
  it("generates a 5-year range centred on the current FY", () => {
    render(<BudgetForm accounts={accounts} budgets={[]} year={2025} />)
    const select = screen.getByRole("combobox") as HTMLSelectElement
    const optionValues = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
    // YEAR_RANGE = 2 → fyNow-2 .. fyNow+2
    expect(optionValues).toEqual(["2023", "2024", "2025", "2026", "2027"])
    expect(within(select).getByText("2025–2026")).toBeInTheDocument()
  })

  it("initialises inputs from the budget map", () => {
    render(
      <BudgetForm
        accounts={accounts}
        budgets={[{ accountId: 1, amount: "1200.00" }]}
        year={2025}
      />
    )
    expect((screen.getByLabelText("Budget for Offerings") as HTMLInputElement).value).toBe("1200.00")
    // No budget row for account 2 → empty input
    expect((screen.getByLabelText("Budget for Utilities") as HTMLInputElement).value).toBe("")
  })

  it("reloads inputs when the year prop changes on re-render", () => {
    // Switching FY re-renders in place with new year/budgets props (router.push,
    // not a remount). Inputs must reflect the newly loaded year, not the stale one.
    const { rerender } = render(
      <BudgetForm accounts={accounts} budgets={[{ accountId: 1, amount: "1200.00" }]} year={2025} />
    )
    expect((screen.getByLabelText("Budget for Offerings") as HTMLInputElement).value).toBe("1200.00")

    rerender(
      <BudgetForm accounts={accounts} budgets={[{ accountId: 1, amount: "3400.00" }]} year={2026} />
    )
    expect((screen.getByLabelText("Budget for Offerings") as HTMLInputElement).value).toBe("3400.00")
  })

  it("renders income and expense accounts under their headings", () => {
    render(<BudgetForm accounts={accounts} budgets={[]} year={2025} />)
    expect(screen.getByText("Income")).toBeInTheDocument()
    expect(screen.getByText("Expenses")).toBeInTheDocument()
    expect(screen.getByLabelText("Budget for Offerings")).toBeInTheDocument()
    expect(screen.getByLabelText("Budget for Utilities")).toBeInTheDocument()
  })

  it("navigates to the selected year via router.push", async () => {
    const user = userEvent.setup()
    render(<BudgetForm accounts={accounts} budgets={[]} year={2025} />)
    await user.selectOptions(screen.getByRole("combobox"), "2026")
    expect(mockPush).toHaveBeenCalledWith("?year=2026")
  })

  it("copies previous-year amounts into the inputs on success", async () => {
    mockPrev.mockResolvedValue([{ accountId: 1, amount: "999.99" }])
    const user = userEvent.setup()
    render(<BudgetForm accounts={accounts} budgets={[]} year={2025} />)

    await user.click(screen.getByRole("button", { name: /Copy from FY2024–2025/ }))

    await waitFor(() =>
      expect((screen.getByLabelText("Budget for Offerings") as HTMLInputElement).value).toBe("999.99")
    )
    expect(mockPrev).toHaveBeenCalledWith(2025)
  })

  it("shows a no-budget message when previous year is empty", async () => {
    mockPrev.mockResolvedValue([])
    const user = userEvent.setup()
    render(<BudgetForm accounts={accounts} budgets={[]} year={2025} />)

    await user.click(screen.getByRole("button", { name: /Copy from FY2024–2025/ }))

    expect(await screen.findByText("No budget found for FY2024–2025")).toBeInTheDocument()
  })

  it("shows a failure message when the copy action throws", async () => {
    mockPrev.mockRejectedValue(new Error("boom"))
    const user = userEvent.setup()
    render(<BudgetForm accounts={accounts} budgets={[]} year={2025} />)

    await user.click(screen.getByRole("button", { name: /Copy from FY2024–2025/ }))

    expect(await screen.findByText("Failed to load previous year budget")).toBeInTheDocument()
  })
})
