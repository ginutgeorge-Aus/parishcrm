import { render, screen } from "@testing-library/react"
import { MinistryRoleBadges } from "@/components/people/MinistryRoleBadges"

describe("MinistryRoleBadges", () => {
  it("renders a labelled badge per role", () => {
    render(<MinistryRoleBadges roles={["STAFF", "SUNDAY_SCHOOL_TEACHER"]} />)
    expect(screen.getByText("Staff")).toBeInTheDocument()
    expect(screen.getByText("Sunday school teacher")).toBeInTheDocument()
  })

  it("renders nothing when there are no roles", () => {
    const { container } = render(<MinistryRoleBadges roles={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
