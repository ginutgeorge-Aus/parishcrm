import { render, screen, within } from "@testing-library/react"
import { PLMonthlyTable } from "@/components/accounting/PLMonthlyTable"
import type { PLAccountRow } from "@/lib/reports/plQuery"

const account: PLAccountRow = { id: 7, code: "4000", name: "Offerings", isActive: true, group: null }
const zeros = () => new Array<number>(12).fill(0)

function renderTable(counts: number[]) {
  render(
    <PLMonthlyTable
      incomeGroups={[{ groupName: "Giving", sortOrder: 0, accounts: [account] }]}
      expenseGroups={[]}
      totalMap={new Map([[7, 0]])}
      totalIncome={0}
      totalExpenses={0}
      net={0}
      year={2025}
      acctMonthlyMap={new Map([[7, zeros()]])}
      acctMonthlyCountMap={new Map([[7, counts]])}
      incomeMonthly={zeros()}
      expenseMonthly={zeros()}
      netMonthly={zeros()}
    />,
  )
}

describe("PLMonthlyTable drill-down links", () => {
  it("links a month whose entries net to zero", () => {
    const counts = zeros()
    counts[0] = 2
    renderTable(counts)
    const monthLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.includes("from=2025-07-01&to=2025-07-31"))
    // Grid renders twice (desktop + mobile collapsible).
    expect(monthLinks.length).toBeGreaterThan(0)
  })

  it("leaves months with no transactions unlinked", () => {
    renderTable(zeros())
    // Only the FY-wide category-name links remain.
    for (const a of screen.getAllByRole("link")) expect(a).toHaveTextContent("Offerings")
  })
})

describe("PLMonthlyTable grid formatting", () => {
  it("shows a dash for zero months and drops the currency symbol in cells", () => {
    const counts = zeros()
    counts[0] = 1
    const monthly = zeros()
    monthly[0] = 123456
    render(
      <PLMonthlyTable
        incomeGroups={[{ groupName: "Giving", sortOrder: 0, accounts: [account] }]}
        expenseGroups={[]}
        totalMap={new Map([[7, 123456]])}
        totalIncome={123456}
        totalExpenses={0}
        net={123456}
        year={2025}
        acctMonthlyMap={new Map([[7, monthly]])}
        acctMonthlyCountMap={new Map([[7, counts]])}
        incomeMonthly={monthly}
        expenseMonthly={zeros()}
        netMonthly={monthly}
      />,
    )
    // Mobile summary cards keep full currency; only the grid is compacted.
    const grid = within(screen.getAllByRole("table")[0])
    expect(grid.getAllByText("1,234.56").length).toBeGreaterThan(0)
    expect(grid.getAllByText("–").length).toBeGreaterThan(0)
    expect(grid.queryByText("$0.00")).toBeNull()
    expect(grid.getByText(/no transactions this financial year are hidden/)).toBeInTheDocument()
  })

  it("skips the subtotal row for a single-account group", () => {
    renderTable(zeros())
    expect(screen.queryByText("Giving subtotal")).toBeNull()
  })
})
