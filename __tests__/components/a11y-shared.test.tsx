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
    expect(screen.getByRole("status")).toHaveTextContent("Loading…")
  })
})

it("Table's scroll container is a keyboard-focusable, named region", () => {
  render(
    <Table aria-label="Transactions">
      <TableBody><TableRow><TableCell>x</TableCell></TableRow></TableBody>
    </Table>
  )
  const region = screen.getByRole("region", { name: "Transactions" })
  expect(region).toHaveAttribute("tabindex", "0")
})

it("dashboard error boundary moves focus to its heading", () => {
  jest.spyOn(console, "error").mockImplementation(() => {})
  render(<DashboardError error={Object.assign(new Error("x"), { digest: "d1" })} reset={() => {}} />)
  expect(screen.getByRole("heading", { name: /something went wrong/i })).toHaveFocus()
  expect(screen.getByRole("alert")).toBeInTheDocument()
})
