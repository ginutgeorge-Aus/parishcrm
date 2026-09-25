import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { OrganizersEditor } from "@/components/events/OrganizersEditor"

describe("OrganizersEditor", () => {
  it("renders name and optional phone inputs for each initial organiser", () => {
    render(<OrganizersEditor initial={[{ name: "Jane", phone: "0400000000" }]} />)
    expect(screen.getByDisplayValue("Jane")).toBeInTheDocument()
    expect(screen.getByDisplayValue("0400000000")).toBeInTheDocument()
  })

  // every row's Remove button announced identically as "Remove
  // organiser" to a screen reader with no indication of which row it removes.
  it("gives each row's Remove button a row-distinguishing accessible name", async () => {
    const user = userEvent.setup()
    render(<OrganizersEditor initial={[{ name: "Jane" }, { name: "John" }]} />)
    expect(screen.getByRole("button", { name: "Remove organiser (row 1)" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Remove organiser (row 2)" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add organiser" }))
    expect(screen.getByRole("button", { name: "Remove organiser (row 3)" })).toBeInTheDocument()
  })
})
