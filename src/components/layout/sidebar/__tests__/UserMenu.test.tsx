import { act, render, screen, fireEvent } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UserMenu, formatRole } from "../UserMenu"
import { logout } from "@/lib/actions/session"
import { unstable_rethrow } from "next/navigation"

jest.mock("@/lib/actions/session", () => ({ logout: jest.fn() }))
jest.mock("next/navigation", () => ({ unstable_rethrow: jest.fn() }))
const mockRethrow = unstable_rethrow as jest.Mock
beforeEach(() => mockRethrow.mockReset())
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Demo Admin", role: "OFFICE_ADMIN" } } }),
}))

const renderMenu = (collapsed = false, onNavigate?: () => void) =>
  render(<TooltipProvider><UserMenu collapsed={collapsed} onNavigate={onNavigate} /></TooltipProvider>)

it("formats roles for display", () => {
  expect(formatRole("OFFICE_ADMIN")).toBe("Office Admin")
  expect(formatRole(undefined)).toBe("")
})

it("shows name and role on the chip and opens a menu with account, help and sign out", () => {
  renderMenu()
  // Expanded, the visible name + role is the accessible name (no aria-label override).
  const trigger = screen.getByRole("button", { name: /demo admin office admin/i })
  expect(trigger).not.toHaveAttribute("aria-label")
  expect(trigger).toHaveTextContent("Demo Admin")
  expect(trigger).toHaveTextContent("Office Admin")
  fireEvent.keyDown(trigger, { key: "Enter" })
  expect(screen.getByRole("menuitem", { name: /my account/i })).toHaveAttribute("href", "/account")
  expect(screen.getByRole("menuitem", { name: /help/i })).toHaveAttribute("href", "/help")
  fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }))
  expect(logout).toHaveBeenCalled()
})

it("shows only the avatar when collapsed", () => {
  renderMenu(true)
  const trigger = screen.getByRole("button", { name: "Account menu: Demo Admin" })
  expect(trigger).not.toHaveTextContent("Demo Admin")
  expect(trigger).toHaveTextContent(/^D$/)
})

// Picking a link from the mobile drawer's menu must close the drawer, or it
// stays open (and the page inert) over the new route.
it.each([/my account/i, /help/i])("calls onNavigate when %s is picked", (item) => {
  const onNavigate = jest.fn()
  renderMenu(false, onNavigate)
  fireEvent.keyDown(screen.getByRole("button", { name: /demo admin/i }), { key: "Enter" })
  fireEvent.click(screen.getByRole("menuitem", { name: item }))
  expect(onNavigate).toHaveBeenCalledTimes(1)
})

it("says so when sign out fails instead of failing silently", async () => {
  ;(logout as jest.Mock).mockRejectedValueOnce(new Error("db down"))
  renderMenu()
  fireEvent.keyDown(screen.getByRole("button", { name: /demo admin/i }), { key: "Enter" })
  await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i })) })
  expect(screen.getByRole("alert")).toHaveTextContent("Sign out failed. Try again.")
})

it("lets a successful sign-out's redirect through instead of reporting a failure", async () => {
  const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" })
  ;(logout as jest.Mock).mockRejectedValueOnce(redirectErr)
  mockRethrow.mockImplementation((e: unknown) => { throw e })
  renderMenu()
  fireEvent.keyDown(screen.getByRole("button", { name: /demo admin/i }), { key: "Enter" })
  // The rethrown redirect escapes startTransition and surfaces from the awaited act() scope.
  let thrown: unknown
  try {
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i })) })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBe(redirectErr)
  expect(mockRethrow).toHaveBeenCalledWith(redirectErr)
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

it("shows a visible sign-out failure on the collapsed rail", async () => {
  ;(logout as jest.Mock).mockRejectedValueOnce(new Error("db down"))
  renderMenu(true)
  fireEvent.keyDown(screen.getByRole("button", { name: "Account menu: Demo Admin" }), { key: "Enter" })
  await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i })) })
  const alert = screen.getByRole("alert")
  expect(alert).toHaveTextContent("Sign out failed")
  expect(alert).not.toHaveClass("sr-only")
})
