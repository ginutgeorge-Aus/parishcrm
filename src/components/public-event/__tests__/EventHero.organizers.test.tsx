import { render, screen } from "@testing-library/react"
import { EventHero } from "@/components/public-event/EventHero"
import type { Organizer } from "@/lib/eventOrganizers"

function hero(organizers?: Organizer[]) {
  return render(
    <EventHero
      title="Camp"
      description={null}
      date={new Date("2026-08-01")}
      endDate={null}
      location="Hall"
      organizers={organizers}
      ticketTypes={[]}
    />,
  )
}

describe("EventHero organizers", () => {
  it("renders nothing when organizers empty/absent", () => {
    hero([])
    expect(screen.queryByText(/Organiser/)).toBeNull()
  })

  it("shows singular label + name + tel link for one organiser", () => {
    hero([{ name: "John Miller", phone: "0412 345 678" }])
    expect(screen.getByText(/^Organiser:/)).toBeInTheDocument()
    expect(screen.getByText("John Miller")).toBeInTheDocument()
    const tel = screen.getByRole("link", { name: "0412 345 678" })
    // whitespace stripped in the href
    expect(tel).toHaveAttribute("href", "tel:0412345678")
  })

  it("shows plural label and renders a name-only organiser with no link", () => {
    hero([{ name: "John" }, { name: "Mary", phone: "0498" }])
    expect(screen.getByText(/^Organisers:/)).toBeInTheDocument()
    expect(screen.getByText("John")).toBeInTheDocument()
    // only Mary has a phone link
    expect(screen.getAllByRole("link")).toHaveLength(1)
    expect(screen.getByRole("link", { name: "0498" })).toHaveAttribute("href", "tel:0498")
  })
})
