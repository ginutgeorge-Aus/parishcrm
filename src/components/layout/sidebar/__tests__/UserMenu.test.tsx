import { render, screen, fireEvent } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UserMenu, formatRole } from "../UserMenu"
import { logout } from "@/lib/actions/session"

jest.mock("@/lib/actions/session", () => ({ logout: jest.fn() }))
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Demo Admin", role: "OFFICE_ADMIN" } } }),
}))

const renderMenu = (collapsed = false) =>
  render(<TooltipProvider><UserMenu collapsed={collapsed} /></TooltipProvider>)

it("formats roles for display", () => {
  expect(formatRole("OFFICE_ADMIN")).toBe("Office admin")
  expect(formatRole(undefined)).toBe("")
})

it("shows name and role on the chip and opens a menu with account, help and sign out", () => {
  renderMenu()
  const trigger = screen.getByRole("button", { name: /account menu/i })
  expect(trigger).toHaveTextContent("Demo Admin")
  expect(trigger).toHaveTextContent("Office admin")
  fireEvent.keyDown(trigger, { key: "Enter" })
  expect(screen.getByRole("menuitem", { name: /my account/i })).toHaveAttribute("href", "/account")
  expect(screen.getByRole("menuitem", { name: /help/i })).toHaveAttribute("href", "/help")
  fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }))
  expect(logout).toHaveBeenCalled()
})

it("shows only the avatar when collapsed", () => {
  renderMenu(true)
  const trigger = screen.getByRole("button", { name: /account menu/i })
  expect(trigger).not.toHaveTextContent("Demo Admin")
  expect(trigger).toHaveTextContent("D")
})
