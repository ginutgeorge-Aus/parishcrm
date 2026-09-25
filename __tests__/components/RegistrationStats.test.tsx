import { render, screen } from "@testing-library/react"
import { RegistrationStats } from "@/components/events/RegistrationStats"

describe("RegistrationStats", () => {
  it("excludes cancelled registrations from the pending count", () => {
    // 5 total = 2 paid + 1 cancelled + 2 pending
    render(
      <RegistrationStats total={5} paid={2} cancelled={1} revenue={20} ticketsSold={[]} />
    )
    // Registered card sub-label
    expect(screen.getByText("2 paid · 2 pending · 1 cancelled")).toBeInTheDocument()
  })

  it("omits the cancelled segment when there are none", () => {
    render(
      <RegistrationStats total={3} paid={1} cancelled={0} revenue={10} ticketsSold={[]} />
    )
    expect(screen.getByText("1 paid · 2 pending")).toBeInTheDocument()
  })
})
