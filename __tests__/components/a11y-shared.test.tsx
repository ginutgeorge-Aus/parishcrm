/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { ListPageSkeleton } from "@/components/shared/ListPageSkeleton"
import { DetailPageSkeleton } from "@/components/shared/DetailPageSkeleton"
import DashboardLoading from "@/app/(dashboard)/loading"
import DashboardError from "@/app/(dashboard)/error"

describe("loading skeletons announce a loading status", () => {
  it.each([
    ["ListPageSkeleton", <ListPageSkeleton key="l" />],
    ["DetailPageSkeleton", <DetailPageSkeleton key="d" />],
    ["dashboard loading.tsx", <DashboardLoading key="r" />],
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
