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
