/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SettingsTabs } from "../SettingsTabs"
import type { SettingsTabGroup } from "@/lib/settingsTabs"
import { UnsavedChangesProvider, useUnsavedGuard } from "../unsavedChanges"

const push = jest.fn()
let pathname = "/settings"
jest.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }))
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
jest.mock("@/components/ui/select", () => {
  const Ctx = require("react").createContext({}) as React.Context<{ onValueChange?: (v: string) => void; value?: string }>
  return {
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
      <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => {
      const { value, onValueChange } = require("react").useContext(Ctx)
      return <select aria-label="Settings section" value={value} onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
    },
    SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectLabel: () => null,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  }
})

const groups: SettingsTabGroup[] = [
  { label: "Church", tabs: [{ href: "/settings", label: "General" }, { href: "/settings/branding", label: "Branding" }] },
  { label: "System", tabs: [{ href: "/settings/audit-log", label: "Audit Log" }] },
]

/** Marks the page dirty. */
function Dirty() {
  useUnsavedGuard(true)
  return null
}

/** The "Settings sections" navigation landmark rendered by SettingsTabs. */
const nav = () => screen.getByRole("navigation", { name: "Settings sections" })

beforeEach(() => {
  push.mockReset()
  pathname = "/settings"
})

it("renders group captions and marks the active tab", () => {
  pathname = "/settings/audit-log/42"
  render(<SettingsTabs groups={groups} />)
  expect(screen.getByText("Church")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Audit Log" })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current")
})

it("mobile select navigates with router.push", () => {
  render(<SettingsTabs groups={groups} />)
  fireEvent.change(screen.getByLabelText("Settings section"), { target: { value: "/settings/branding" } })
  expect(push).toHaveBeenCalledWith("/settings/branding")
})

describe("dirty guard", () => {
  const confirm = jest.spyOn(window, "confirm")
  afterEach(() => confirm.mockReset())

  it("blocks a desktop link click when the user cancels", () => {
    confirm.mockReturnValue(false)
    render(<UnsavedChangesProvider><SettingsTabs groups={groups} /><Dirty /></UnsavedChangesProvider>)
    const link = screen.getByRole("link", { name: "Branding" })
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes?")
    expect(event.defaultPrevented).toBe(true)
  })

  it("blocks a mobile select change when the user cancels, allows it on OK", () => {
    confirm.mockReturnValue(false)
    render(<UnsavedChangesProvider><SettingsTabs groups={groups} /><Dirty /></UnsavedChangesProvider>)
    const select = screen.getByLabelText("Settings section")
    fireEvent.change(select, { target: { value: "/settings/branding" } })
    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes?")
    expect(push).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.change(select, { target: { value: "/settings/audit-log" } })
    expect(push).toHaveBeenCalledWith("/settings/audit-log")
  })

  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }])(
    "does not ask (or block) a new-tab click %o",
    (init) => {
      render(<UnsavedChangesProvider><SettingsTabs groups={groups} /><Dirty /></UnsavedChangesProvider>)
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init })
      within(nav()).getByRole("link", { name: "Branding" }).dispatchEvent(event)
      expect(confirm).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    },
  )

  it("does not ask when nothing is dirty", () => {
    render(<UnsavedChangesProvider><SettingsTabs groups={groups} /></UnsavedChangesProvider>)
    within(nav()).getByRole("link", { name: "Branding" }).click()
    expect(confirm).not.toHaveBeenCalled()
  })
})
