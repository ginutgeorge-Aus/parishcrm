import { render, screen, within } from "@testing-library/react"
import { PLMonthlyTable } from "@/components/accounting/PLMonthlyTable"
import type { PLAccountRow } from "@/lib/reports/plQuery"
import { APP_LOCALE } from "@/lib/appConfig"

// Expected strings follow APP_LOCALE so the suite passes under any configured locale.
const num = (n: number) =>
  new Intl.NumberFormat(APP_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

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
    expect(grid.getAllByText(num(1234.56)).length).toBeGreaterThan(0)
    expect(grid.getAllByText("–").length).toBeGreaterThan(0)
    expect(grid.queryByText("$0.00")).toBeNull()
    expect(grid.getByText(/no transactions this financial year are hidden/)).toBeInTheDocument()
  })

  it("shows dashes and a muted net on an empty mobile month card", () => {
    renderTable(zeros())
    const card = screen.getByText("JUL", { selector: "div" }).parentElement
    if (!card) {
      throw new Error("Expected card parent element to be present")
    }
    expect(within(card).getAllByText("–")).toHaveLength(3)
    const netElement = within(card).getByText("Net").nextElementSibling
    if (!netElement) {
      throw new Error("Expected Net sibling element to be present")
    }
    const net = netElement
    expect(net).toHaveClass("text-muted-foreground")
    expect(net).not.toHaveClass("text-income")
  })

  it("skips the subtotal row for a single-account group", () => {
    renderTable(zeros())
    expect(screen.queryByText("Giving subtotal")).toBeNull()
  })
})

describe("PLMonthlyTable group subtotal", () => {
  it("renders a subtotal row with one cell per month for a multi-account group", () => {
    const second: PLAccountRow = { id: 8, code: "4001", name: "Tithes", isActive: true, group: null }
    const monthly = zeros()
    monthly[1] = 2500
    render(
      <PLMonthlyTable
        incomeGroups={[{ groupName: "Giving", sortOrder: 0, accounts: [account, second] }]}
        expenseGroups={[]}
        totalMap={new Map([[7, 2500], [8, 2500]])}
        totalIncome={5000}
        totalExpenses={0}
        net={5000}
        year={2025}
        acctMonthlyMap={new Map([[7, monthly], [8, monthly]])}
        acctMonthlyCountMap={new Map([[7, zeros()], [8, zeros()]])}
        incomeMonthly={zeros()}
        expenseMonthly={zeros()}
        netMonthly={zeros()}
      />,
    )
    const row = within(screen.getAllByRole("table")[0]).getByText("Giving subtotal").closest("tr")
    expect(row?.querySelectorAll("td")).toHaveLength(14)
    expect(row).toHaveTextContent(num(50))
  })
})

describe("PLMonthlyTable layout", () => {
  it("shows an empty state instead of a bare grid when the FY has no transactions", () => {
    render(
      <PLMonthlyTable
        incomeGroups={[]}
        expenseGroups={[]}
        totalMap={new Map()}
        totalIncome={0}
        totalExpenses={0}
        net={0}
        year={2025}
        acctMonthlyMap={new Map()}
        acctMonthlyCountMap={new Map()}
        incomeMonthly={zeros()}
        expenseMonthly={zeros()}
        netMonthly={zeros()}
      />,
    )
    expect(screen.getByRole("heading", { name: "No income or expenses this financial year" })).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("pins the Category column and header labels only from lg up", () => {
    renderTable(zeros())
    const grid = within(screen.getAllByRole("table")[0])
    const categoryCell = grid.getByText("Offerings").closest("td")
    expect(categoryCell).toHaveClass("lg:sticky")
    expect(categoryCell).not.toHaveClass("sticky")
    expect(grid.getByText("Giving")).toHaveClass("lg:sticky")
    expect(grid.getByText("Income")).toHaveClass("lg:sticky")
  })
})
