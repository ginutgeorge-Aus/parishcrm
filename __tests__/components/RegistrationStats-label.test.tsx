import { render, screen } from "@testing-library/react"
import { RegistrationStats } from "@/components/events/RegistrationStats"

describe("RegistrationStats — tickets sold card", () => {
  it("uses a sentence-case label and sums the ticket counts", () => {
    render(
      <RegistrationStats
        total={4}
        paid={4}
        cancelled={0}
        revenue={80}
        cardRevenue={0}
        transferRevenue={80}
        ticketsSold={[
          { name: "Adult", count: 3 },
          { name: "Child", count: 1 },
        ]}
      />
    )
    expect(screen.getByText("Tickets sold")).toBeInTheDocument()
    expect(screen.getByText("Adult 3 · Child 1")).toBeInTheDocument()
  })
})
