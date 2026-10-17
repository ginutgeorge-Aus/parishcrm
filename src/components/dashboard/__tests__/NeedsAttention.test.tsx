import { render, screen } from "@testing-library/react"
import { NeedsAttention } from "@/components/dashboard/NeedsAttention"

describe("NeedsAttention", () => {
  it("renders each item as a link with its count and label", () => {
    render(
      <NeedsAttention
        items={[
          { key: "memberships", label: "Membership applications to review", count: 3, href: "/memberships?status=PENDING" },
          { key: "birthdays", label: "Birthdays in the next 7 days", count: 2, href: "/people/birthdays" },
        ]}
      />,
    )
    expect(screen.getByRole("heading", { level: 2, name: "Needs attention" })).toBeInTheDocument()
    const links = screen.getAllByRole("link")
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute("href", "/memberships?status=PENDING")
    expect(links[0]).toHaveTextContent("3")
    expect(links[0]).toHaveTextContent("Membership applications to review")
    expect(links[1]).toHaveAttribute("href", "/people/birthdays")
    expect(screen.queryByText(/All caught up/)).not.toBeInTheDocument()
  })

  it("renders a lower-bound count as N+", () => {
    render(
      <NeedsAttention
        items={[{ key: "birthdays", label: "Birthdays in the next 7 days", count: 2, atLeast: true, href: "/people/birthdays" }]}
      />,
    )
    expect(screen.getByRole("link")).toHaveTextContent("2+")
  })

  it("shows the all-caught-up state when there is nothing pending", () => {
    render(<NeedsAttention items={[]} />)
    expect(screen.getByText(/All caught up/)).toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })
})
