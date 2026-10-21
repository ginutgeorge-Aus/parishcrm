/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { OrganiserHeader } from "@/components/organiser/OrganiserHeader"

jest.mock("@/lib/actions/session", () => ({ logout: jest.fn() }))
jest.mock("next/image", () => ({ __esModule: true, default: () => null }))

it("shows the Events and Classes links by default", () => {
  render(<OrganiserHeader />)
  expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute("href", "/my-events")
  expect(screen.getByRole("link", { name: "Classes" })).toBeInTheDocument()
})

it("hides the Events link while the events feature is off", () => {
  render(<OrganiserHeader showEvents={false} />)
  expect(screen.queryByRole("link", { name: "Events" })).not.toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Classes" })).toBeInTheDocument()
})

it("hides the Classes link while Sunday School is off", () => {
  render(<OrganiserHeader showClasses={false} />)
  expect(screen.queryByRole("link", { name: "Classes" })).not.toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Events" })).toBeInTheDocument()
})

it("brands as My Events linking to /my-events while Events is on", () => {
  render(<OrganiserHeader />)
  expect(screen.getByRole("link", { name: "My Events" })).toHaveAttribute("href", "/my-events")
})

it("brands with the home resolved by the layout", () => {
  render(<OrganiserHeader showEvents={false} home={{ href: "/my-classes", label: "My Classes" }} />)
  expect(screen.getByRole("link", { name: "My Classes" })).toHaveAttribute("href", "/my-classes")
  expect(screen.queryByRole("link", { name: "My Events" })).not.toBeInTheDocument()
})
