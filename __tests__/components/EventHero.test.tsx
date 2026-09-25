import { render } from "@testing-library/react"
import { EventHero } from "@/components/public-event/EventHero"

const base = {
  title: "Gala", description: null, date: null, endDate: null,
  location: null, ticketTypes: [], recursLabel: null, startTime: null, category: null,
}

// The hero image is decorative (alt="") — the visible <h1> already carries the
// title, so it has no accessible name to query by. Assert on the <img src>.
it("renders the poster as the hero and no banner when posterSrc is set", () => {
  const { container } = render(<EventHero {...base} posterSrc="/api/events/gala/image/poster" bannerSrc="/api/events/gala/image/banner" />)
  expect(container.querySelector("img")).toHaveAttribute("src", "/api/events/gala/image/poster")
})

it("falls back to the banner when no poster", () => {
  const { container } = render(<EventHero {...base} posterSrc={null} bannerSrc="https://x/y.jpg" />)
  expect(container.querySelector("img")).toHaveAttribute("src", "https://x/y.jpg")
})

it("renders the gradient (no img) when neither is set", () => {
  const { container } = render(<EventHero {...base} posterSrc={null} bannerSrc={null} />)
  expect(container.querySelector("img")).toBeNull()
})
