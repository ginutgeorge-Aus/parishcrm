import { render, screen } from "@testing-library/react"
import { PeopleFilters } from "@/components/people/PeopleFilters"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams("ministryRole=VOLUNTEER"),
}))

describe("PeopleFilters ministry role select", () => {
  it("renders the ministry role filter showing the current selection", () => {
    render(<PeopleFilters />)
    const trigger = screen.getByRole("combobox", { name: "Filter by ministry role" })
    expect(trigger).toHaveTextContent("Volunteer")
  })

  it("shows the Clear button when a ministry role filter is active", () => {
    render(<PeopleFilters />)
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument()
  })
})
