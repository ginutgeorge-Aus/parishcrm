import { render, screen } from "@testing-library/react"
import { RegistrationClosedPanel } from "@/components/public-event/RegistrationClosedPanel"

describe("RegistrationClosedPanel", () => {
  it("shows the closed message and organiser name + phone link", () => {
    render(<RegistrationClosedPanel title="Onam Sadya" organizers={[{ name: "Jane Smith", phone: "0412 345 678" }]} />)
    expect(screen.getByText(/Registration for/)).toHaveTextContent("Registration for Onam Sadya is closed.")
    expect(screen.getByText("Jane Smith")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: "0412 345 678" })
    expect(link).toHaveAttribute("href", "tel:0412345678")
  })

  it("renders a name without a phone link when phone is absent", () => {
    render(<RegistrationClosedPanel title="Retreat" organizers={[{ name: "Tom Lee" }]} />)
    expect(screen.getByText("Tom Lee")).toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("falls back to the church office line when no organisers", () => {
    render(<RegistrationClosedPanel title="Retreat" organizers={[]} />)
    expect(screen.getByText(/church office/i)).toBeInTheDocument()
    expect(screen.queryByText(/Please contact:/)).not.toBeInTheDocument()
  })
})
