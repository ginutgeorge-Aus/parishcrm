/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { ListPageSkeleton } from "@/components/shared/ListPageSkeleton"
import { DetailPageSkeleton } from "@/components/shared/DetailPageSkeleton"
import DashboardLoading from "@/app/(dashboard)/loading"
import AccountingLoading from "@/app/(dashboard)/accounting/loading"
import MembershipsLoading from "@/app/(dashboard)/memberships/loading"
import ReportsLoading from "@/app/(dashboard)/reports/loading"
import { CardTitle } from "@/components/ui/card"
import { BirthdayWidget } from "@/components/dashboard/BirthdayWidget"
import DashboardError from "@/app/(dashboard)/error"

describe("loading skeletons announce a loading status", () => {
  it.each([
    ["ListPageSkeleton", <ListPageSkeleton key="l" />],
    ["DetailPageSkeleton", <DetailPageSkeleton key="d" />],
    ["dashboard loading.tsx", <DashboardLoading key="r" />],
    ["accounting loading.tsx", <AccountingLoading key="a" />],
    ["memberships loading.tsx", <MembershipsLoading key="m" />],
    ["reports loading.tsx", <ReportsLoading key="p" />],
  ])("%s", (_name, el) => {
    render(el)
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Loading…")
    expect(status).not.toHaveAttribute("aria-busy")
  })
})

describe("labelled Table scroll container", () => {
  const renderTable = () =>
    render(
      <Table aria-label="Transactions">
        <TableBody><TableRow><TableCell>x</TableCell></TableRow></TableBody>
      </Table>
    )
  const setWidths = (scrollWidth: number, clientWidth: number) => {
    jest.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth)
    jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth)
  }
  afterEach(() => jest.restoreAllMocks())

  it("is a keyboard-focusable named region when it overflows", () => {
    setWidths(800, 400)
    renderTable()
    expect(screen.getByRole("region", { name: "Transactions" })).toHaveAttribute("tabindex", "0")
  })

  it("is a named region but not a tab stop when it fits", () => {
    setWidths(400, 400)
    renderTable()
    expect(screen.getByRole("region", { name: "Transactions" })).not.toHaveAttribute("tabindex")
  })
})

it("an unlabelled Table adds no landmark or tab stop", () => {
  const { container } = render(
    <Table>
      <TableBody><TableRow><TableCell>x</TableCell></TableRow></TableBody>
    </Table>
  )
  expect(screen.queryByRole("region")).not.toBeInTheDocument()
  expect(container.querySelector('[data-slot="table-container"]')).not.toHaveAttribute("tabindex")
})

it("dashboard error boundary moves focus to its heading", () => {
  jest.spyOn(console, "error").mockImplementation(() => {})
  render(<DashboardError error={Object.assign(new Error("x"), { digest: "d1" })} reset={() => {}} />)
  expect(screen.getByRole("heading", { name: /something went wrong/i })).toHaveFocus()
  // Focus alone announces it — no role="alert", which would read it twice.
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

describe("CardTitle heading level", () => {
  it("renders a div by default", () => {
    render(<CardTitle>Plain</CardTitle>)
    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
  })

  it("renders the requested heading element", () => {
    render(<CardTitle as="h3">Totals</CardTitle>)
    expect(screen.getByRole("heading", { level: 3, name: "Totals" })).toBeInTheDocument()
  })

  it("dashboard widgets expose a heading without reading the emoji", () => {
    render(<BirthdayWidget birthdays={[]} truncated={false} />)
    const heading = screen.getByRole("heading", { level: 4, name: "Birthdays this week" })
    expect(heading.querySelector('[aria-hidden="true"]')).toHaveTextContent("🎂")
  })
})
