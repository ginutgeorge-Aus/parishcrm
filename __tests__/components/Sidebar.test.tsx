import { render, screen, fireEvent } from "@testing-library/react"
import { Sidebar } from "@/components/layout/Sidebar"

let mockPathname = "/"
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }))
jest.mock("@/lib/actions/session", () => ({ logout: jest.fn() }))
jest.mock("@/components/layout/FeedbackDialog", () => ({
  FeedbackDialog: ({ collapsed }: { collapsed?: boolean }) => (
    <button aria-label="Feedback">{collapsed ? null : "Feedback"}</button>
  ),
}))

// `undefined` reproduces a cold reload where useSession() has no hydrated
// session yet, so no role-gated item is visible on first render.
let mockRole: string | undefined = "ADMIN"
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: mockRole ? { user: { role: mockRole } } : undefined }),
}))

afterEach(() => {
  mockPathname = "/"
  mockRole = "ADMIN"
  window.localStorage.clear()
})

it("shows Family Updates with a badge for editors", () => {
  mockRole = "ADMIN"
  render(<Sidebar churchName="Example Church" pendingUpdates={4} />)
  // Sidebar renders both a mobile and a desktop nav, so the item appears twice.
  const links = screen.getAllByRole("link", { name: /family updates/i })
  expect(links.length).toBeGreaterThan(0)
  expect(links[0]).toHaveAttribute("href", "/families/updates")
  expect(links[0]).toHaveTextContent("4")
})

it("hides Family Updates for viewers", () => {
  mockRole = "VIEWER"
  render(<Sidebar churchName="Example Church" pendingUpdates={4} />)
  expect(screen.queryAllByRole("link", { name: /family updates/i })).toHaveLength(0)
})

it("groups Accounting items under Transactions/Reports/Admin sub-headers", () => {
  mockRole = "ADMIN"
  mockPathname = "/accounting"
  render(<Sidebar churchName="Example Church" />)
  expect(screen.getAllByText("Transactions").length).toBeGreaterThan(0)
  expect(screen.getAllByText("Reports").length).toBeGreaterThan(0)
  expect(screen.getAllByText("Admin").length).toBeGreaterThan(0)
})

it("collapsing to icon-only rail removes desktop link labels and persists the choice", () => {
  mockRole = "ADMIN"
  render(<Sidebar churchName="Example Church" />)
  // Mobile drawer is aria-hidden/inert at rest, so only the desktop link is
  // in the accessible tree while expanded.
  expect(screen.getAllByRole("link", { name: /^dashboard$/i })).toHaveLength(1)

  fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }))

  // Desktop link becomes icon-only but keeps its accessible name via
  // aria-label — visible text is gone, the link is still announced.
  const collapsedLink = screen.getByRole("link", { name: /^dashboard$/i })
  expect(collapsedLink).not.toHaveTextContent("Dashboard")
  expect(window.localStorage.getItem("sidebar-collapsed")).toBe("true")
})

it("keeps a Feedback trigger rendered when the desktop rail is collapsed", () => {
  mockRole = "ADMIN"
  render(<Sidebar churchName="Example Church" />)
  fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }))
  expect(screen.getAllByRole("button", { name: "Feedback" }).length).toBeGreaterThan(0)
})

it("restores collapsed rail state from localStorage on mount", () => {
  window.localStorage.setItem("sidebar-collapsed", "true")
  mockRole = "ADMIN"
  render(<Sidebar churchName="Example Church" />)
  const collapsedLink = screen.getByRole("link", { name: /^dashboard$/i })
  expect(collapsedLink).not.toHaveTextContent("Dashboard")
})

// a cold deep-link into /accounting/* first renders with role=undefined
// (no hydrated session), so the Accounting group has no visible items and the
// mount-only restore never force-opens it. Once useSession() resolves to a real
// role, the group must auto-expand — it can't stay collapsed on the active page.
it("auto-expands the active group after the session resolves on a cold reload", () => {
  mockPathname = "/accounting/transactions"
  mockRole = undefined // first render: session still loading
  const { rerender } = render(<Sidebar churchName="Example Church" />)

  // Session resolves to an ADMIN — role-gated Accounting items become visible.
  mockRole = "ADMIN"
  rerender(<Sidebar churchName="Example Church" />)

  const accountingToggle = screen.getByRole("button", { name: /^accounting$/i })
  expect(accountingToggle).toHaveAttribute("aria-expanded", "true")
})
