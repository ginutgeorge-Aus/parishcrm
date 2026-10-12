import { render, screen, fireEvent, act } from "@testing-library/react"

const update = jest.fn().mockResolvedValue(null)
jest.mock("next-auth/react", () => ({ useSession: () => ({ update }) }))
jest.mock("@/lib/actions/session", () => ({ logout: jest.fn() }))

import { logout } from "@/lib/actions/session"
import { IdleTimeout } from "@/components/auth/IdleTimeout"

const MIN = 60_000

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
})
afterEach(() => jest.useRealTimers())

/** Advance fake time inside act so interval ticks flush their state updates. */
function advance(ms: number) {
  act(() => { jest.advanceTimersByTime(ms) })
}

it("warns a minute before the idle window and logs out at it", () => {
  render(<IdleTimeout idleMinutes={15} />)
  advance(13 * MIN)
  expect(screen.queryByRole("alert")).toBeNull()
  advance(1 * MIN + 1_000)
  expect(screen.getByRole("alert")).toHaveTextContent("Session expiring")
  expect(logout).not.toHaveBeenCalled()
  advance(MIN)
  expect(logout).toHaveBeenCalledTimes(1)
  advance(10 * MIN)
  expect(logout).toHaveBeenCalledTimes(1)
})

it("activity before the warning pushes the deadline back", () => {
  render(<IdleTimeout idleMinutes={15} />)
  advance(10 * MIN)
  fireEvent.mouseMove(window)
  advance(10 * MIN)
  expect(screen.queryByRole("alert")).toBeNull()
  expect(logout).not.toHaveBeenCalled()
})

it("pings the server session at most once a minute on activity", () => {
  render(<IdleTimeout idleMinutes={15} />)
  expect(update).toHaveBeenCalledTimes(1) // mount
  for (let i = 0; i < 20; i++) fireEvent.mouseMove(window)
  expect(update).toHaveBeenCalledTimes(1)
  advance(MIN + 1)
  fireEvent.keyDown(window)
  expect(update).toHaveBeenCalledTimes(2)
})

it("a stray mouse move does not dismiss the warning; Stay logged in does", () => {
  render(<IdleTimeout idleMinutes={15} />)
  advance(14 * MIN + 1_000)
  fireEvent.mouseMove(window)
  fireEvent.scroll(window)
  expect(screen.getByRole("alert")).toBeInTheDocument()

  fireEvent.click(screen.getByRole("button", { name: "Stay logged in" }))
  expect(screen.queryByRole("alert")).toBeNull()
  expect(update).toHaveBeenCalledTimes(2) // mount + stay
  advance(5 * MIN)
  expect(logout).not.toHaveBeenCalled()
})

it("ignores activity while the warning shows, so logout still happens on time", () => {
  render(<IdleTimeout idleMinutes={15} />)
  advance(14 * MIN + 1_000)
  fireEvent.mouseMove(window)
  advance(MIN)
  expect(logout).toHaveBeenCalledTimes(1)
})

it("clears a showing warning when the idle window changes", () => {
  const { rerender } = render(<IdleTimeout idleMinutes={15} />)
  advance(14 * MIN + 1_000)
  expect(screen.getByRole("alert")).toBeInTheDocument()
  rerender(<IdleTimeout idleMinutes={30} />)
  expect(screen.queryByRole("alert")).toBeNull()
  // Passive activity counts again: it pushes the new window back.
  advance(20 * MIN)
  fireEvent.mouseMove(window)
  advance(20 * MIN)
  expect(screen.queryByRole("alert")).toBeNull()
  expect(logout).not.toHaveBeenCalled()
})
