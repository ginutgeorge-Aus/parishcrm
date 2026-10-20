import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { TopBar } from "../TopBar"
import { ShellProvider } from "../ShellContext"
import type { FeatureKey } from "@/lib/features"

let mockRole: string | undefined = "ADMIN"
jest.mock("next-auth/react", () => ({ useSession: () => ({ data: mockRole ? { user: { role: mockRole } } : undefined }) }))
jest.mock("next/navigation", () => ({ usePathname: () => "/" }))
jest.mock("@/lib/actions/feedback", () => ({ submitFeedback: jest.fn() }))

afterEach(() => { mockRole = "ADMIN" })

const renderBar = (props: Partial<React.ComponentProps<typeof TopBar>> = {}) =>
  render(<TopBar churchName="Example Church" {...props} />, { wrapper: ShellProvider })

it("opens the New menu with role-allowed entries", () => {
  renderBar()
  fireEvent.keyDown(screen.getAllByRole("button", { name: /^new$/i })[0], { key: "Enter" })
  expect(screen.getByRole("menuitem", { name: "Transaction" })).toHaveAttribute("href", "/accounting/transactions/new")
  expect(screen.getByRole("menuitem", { name: "Person" })).toHaveAttribute("href", "/people/new")
})

it("hides the New button when the role can add nothing", () => {
  mockRole = "VIEWER"
  renderBar()
  expect(screen.queryAllByRole("button", { name: /^new$/i })).toHaveLength(0)
})

it("drops entries for features that are off", () => {
  renderBar({ features: ["accounting"] as FeatureKey[] })
  fireEvent.keyDown(screen.getAllByRole("button", { name: /^new$/i })[0], { key: "Enter" })
  expect(screen.queryByRole("menuitem", { name: "Event" })).toBeNull()
})

it("bell shows a dot and links only the non-zero counts", () => {
  renderBar({ pendingUpdates: 2, membershipPending: 0 })
  const bell = screen.getByRole("button", { name: "Notifications (2 pending)" })
  expect(bell.querySelector('[data-testid="bell-dot"]')).not.toBeNull()
  fireEvent.keyDown(bell, { key: "Enter" })
  expect(screen.getByRole("menuitem", { name: /family updates/i })).toHaveAttribute("href", "/families/updates")
  expect(screen.queryByRole("menuitem", { name: /membership forms/i })).toBeNull()
})

it("bell shows an all-caught-up state with no counts", () => {
  renderBar()
  const bell = screen.getByRole("button", { name: "Notifications" })
  expect(bell.querySelector('[data-testid="bell-dot"]')).toBeNull()
  fireEvent.keyDown(bell, { key: "Enter" })
  expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
})

it("shows the Settings link to admins only", () => {
  renderBar()
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings")
  cleanup()
  mockRole = "PASTOR"
  renderBar()
  expect(screen.queryByRole("link", { name: "Settings" })).toBeNull()
})

it("hamburger toggles the shared drawer state", () => {
  renderBar()
  const menu = screen.getByRole("button", { name: "Open menu" })
  expect(menu).toHaveAttribute("aria-expanded", "false")
  fireEvent.click(menu)
  expect(menu).toHaveAttribute("aria-expanded", "true")
})

// The server passes the role so admin controls render on first paint, before
// the client session has loaded.
it("uses the server role while the client session is still loading", () => {
  mockRole = undefined
  renderBar({ role: "ADMIN" })
  expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument()
})
