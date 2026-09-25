import { render, screen, act } from "@testing-library/react"
import { EventSavedBanner } from "@/components/events/EventSavedBanner"

const replace = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/events/1/edit",
}))

beforeEach(() => {
  jest.useFakeTimers()
  replace.mockClear()
})
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

it("shows the success flash and strips ?saved=1 from the URL", () => {
  render(<EventSavedBanner />)
  expect(screen.getByRole("status")).toHaveTextContent("Event saved.")
  // Immediately rewrites to the bare pathname so a reload/back can't replay it.
  expect(replace).toHaveBeenCalledWith("/events/1/edit")
})

it("auto-dismisses after 4s", () => {
  render(<EventSavedBanner />)
  expect(screen.queryByRole("status")).not.toBeNull()
  act(() => { jest.advanceTimersByTime(4000) })
  expect(screen.queryByRole("status")).toBeNull()
})
