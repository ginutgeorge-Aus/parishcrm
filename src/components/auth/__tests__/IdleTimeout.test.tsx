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

describe("across tabs", () => {
  const KEY = "idleTimeout:lastActivity"
  beforeEach(() => window.localStorage.clear())

  it("activity in another tab keeps this tab from logging out", () => {
    render(<IdleTimeout idleMinutes={15} />)
    advance(10 * MIN)
    window.localStorage.setItem(KEY, String(Date.now()))
    advance(10 * MIN)
    expect(logout).not.toHaveBeenCalled()
    advance(6 * MIN)
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it("activity in another tab clears this tab's warning", () => {
    render(<IdleTimeout idleMinutes={15} />)
    advance(14 * MIN + 1_000)
    expect(screen.getByRole("alert")).toBeInTheDocument()
    window.localStorage.setItem(KEY, String(Date.now()))
    advance(1_000)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shares this tab's activity with other tabs", () => {
    render(<IdleTimeout idleMinutes={15} />)
    advance(5 * MIN)
    fireEvent.mouseMove(window)
    const at = Date.now()
    advance(1_000)
    expect(Number(window.localStorage.getItem(KEY))).toBe(at)
  })

  it("still times out when storage is unavailable", () => {
    const get = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    const set = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    render(<IdleTimeout idleMinutes={15} />)
    advance(15 * MIN + 1_000)
    expect(logout).toHaveBeenCalledTimes(1)
    get.mockRestore()
    set.mockRestore()
  })
})
