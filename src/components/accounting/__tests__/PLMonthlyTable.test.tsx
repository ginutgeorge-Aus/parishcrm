import { render, screen } from "@testing-library/react"
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
