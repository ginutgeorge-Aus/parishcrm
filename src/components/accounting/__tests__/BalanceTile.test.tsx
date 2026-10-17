import { render, screen } from "@testing-library/react"
import { BalanceTile, formatSignedBalance } from "@/components/accounting/BalanceTile"

describe("formatSignedBalance", () => {
  it("marks positive, negative and zero balances", () => {
    expect(formatSignedBalance(130.25)).toBe("+$130.25")
    expect(formatSignedBalance(-5.5)).toBe("−$5.50")
    expect(formatSignedBalance(0)).toBe("$0.00")
  })
})

describe("BalanceTile", () => {
  it("tints a positive balance green with a + marker, no side stripe", () => {
    const { container } = render(<BalanceTile label="Main Cheque" balance={42} />)
    const tile = container.firstElementChild!
    expect(tile.className).toContain("bg-income/10")
    expect(tile.className).not.toMatch(/border-l/)
    expect(screen.getByText("+$42.00")).toHaveClass("text-income")
  })

  it("tints a negative balance red with a − marker", () => {
    const { container } = render(<BalanceTile label="Savings" balance={-3} />)
    expect(container.firstElementChild!.className).toContain("bg-expense/10")
    expect(screen.getByText("−$3.00")).toHaveClass("text-expense")
  })

  it("shows a neutral dash and the footnote when the balance is unknown", () => {
    const { container } = render(
      <BalanceTile label="New" balance={null}>
        <span>Set opening balance</span>
      </BalanceTile>,
    )
    expect(container.firstElementChild!.className).toContain("bg-card")
    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.getByText("Set opening balance")).toBeInTheDocument()
  })
})
