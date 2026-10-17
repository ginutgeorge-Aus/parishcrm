import { render, screen } from "@testing-library/react"
import { FamilyList } from "@/components/families/FamilyList"

const links = () => screen.queryAllByRole("link").map((a) => a.getAttribute("href"))

describe("FamilyList empty states", () => {
  it("offers Add family and Import CSV to an ADMIN on a first run", () => {
    render(<FamilyList families={[]} canEdit canImport />)
    expect(screen.getByText("No families yet")).toBeInTheDocument()
    expect(links()).toEqual(["/families/new", "/import"])
  })

  it("offers only Add family to an editor who can't import", () => {
    render(<FamilyList families={[]} canEdit />)
    expect(links()).toEqual(["/families/new"])
  })

  it("shows a VIEWER the text only", () => {
    render(<FamilyList families={[]} canEdit={false} />)
    expect(links()).toEqual([])
    expect(screen.queryByText(/add your first family/i)).not.toBeInTheDocument()
  })

  it("does not claim 'no matches' when the suburb scan was capped", () => {
    render(<FamilyList families={[]} canEdit isFiltered scanIncomplete />)
    expect(screen.queryByText("No families match your filters")).not.toBeInTheDocument()
    expect(screen.getByText(/only covers part of the directory/i)).toBeInTheDocument()
    expect(links()).toEqual(["/families"])
  })

  it("offers Clear filters when filters hide every family", () => {
    render(<FamilyList families={[]} canEdit canImport isFiltered />)
    expect(screen.getByText("No families match your filters")).toBeInTheDocument()
    expect(links()).toEqual(["/families"])
  })
})
