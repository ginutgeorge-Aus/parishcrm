import { render, screen } from "@testing-library/react"
import { PeopleList } from "@/components/people/PeopleList"

const links = () => screen.queryAllByRole("link").map((a) => a.getAttribute("href"))

describe("PeopleList empty states", () => {
  it("offers Add person and Import CSV on an empty directory to an ADMIN", () => {
    render(<PeopleList people={[]} canAdd canImport />)
    expect(screen.getByRole("heading", { name: "No people yet" })).toBeInTheDocument()
    expect(links()).toEqual(["/people/new", "/import"])
  })

  it("offers Add family instead of a dead-end Add person when no family exists", () => {
    render(<PeopleList people={[]} canAdd canImport hasFamilies={false} />)
    expect(links()).toEqual(["/families/new", "/import"])
  })

  it("shows a VIEWER the text only", () => {
    render(<PeopleList people={[]} />)
    expect(screen.getByText("No people yet")).toBeInTheDocument()
    expect(links()).toEqual([])
  })

  it("offers Clear filters, not Add, when filters hide everyone", () => {
    render(<PeopleList people={[]} isFiltered canAdd canImport />)
    expect(screen.getByText("No people match your filters")).toBeInTheDocument()
    expect(links()).toEqual(["/people"])
  })
})
