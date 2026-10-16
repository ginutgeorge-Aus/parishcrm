import { render, screen, fireEvent } from "@testing-library/react"
import { Home, User } from "lucide-react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarGroup } from "@/components/layout/sidebar/SidebarGroup"
import type { NavGroup } from "@/components/layout/sidebar/navData"

const group: NavGroup = {
  label: "Accounting",
  items: [
    {
      subLabel: "Transactions",
      items: [{ href: "/accounting", label: "Overview", icon: Home, show: true }],
    },
    {
      subLabel: "Admin",
      items: [{ href: "/accounting/settings", label: "Acct. Settings", icon: User, show: false }],
    },
  ],
}

function renderGroup(isOpen: boolean, onToggle: () => void = jest.fn()) {
  return render(
    <TooltipProvider>
      <SidebarGroup
        group={group}
        isOpen={isOpen}
        hasActive={false}
        isActive={() => false}
        onToggle={onToggle}
        onNavigate={jest.fn()}
      />
    </TooltipProvider>
  )
}

it("renders sub-headers with at least one visible item, hides empty ones", () => {
  renderGroup(true)
  expect(screen.getByText("Transactions")).toBeInTheDocument()
  expect(screen.queryByText("Admin")).not.toBeInTheDocument() // its only item has show: false
  expect(screen.getByText("Overview")).toBeInTheDocument()
})

it("hides entries when the group is closed", () => {
  renderGroup(false)
  // Panel stays mounted (so aria-controls resolves) but is hidden from AT + layout.
  expect(screen.queryByRole("link", { name: /overview/i })).not.toBeInTheDocument()
  const header = screen.getByRole("button", { name: /accounting/i })
  expect(document.getElementById(header.getAttribute("aria-controls")!)).not.toBeVisible()
})

it("calls onToggle when the header is clicked", () => {
  const onToggle = jest.fn()
  renderGroup(true, onToggle)
  fireEvent.click(screen.getByRole("button", { name: /accounting/i }))
  expect(onToggle).toHaveBeenCalledTimes(1)
})

it("wires aria-controls on the toggle to the panel's id", () => {
  renderGroup(true)
  const button = screen.getByRole("button", { name: /accounting/i })
  const controlsId = button.getAttribute("aria-controls")
  expect(controlsId).toBeTruthy()
  expect(document.getElementById(controlsId!)).toBe(screen.getByText("Overview").closest(`#${controlsId}`))
})

const renderCustom = (g: NavGroup, isOpen: boolean) =>
  render(
    <TooltipProvider>
      <SidebarGroup group={g} isOpen={isOpen} hasActive={false} isActive={() => false} onToggle={jest.fn()} onNavigate={jest.fn()} />
    </TooltipProvider>
  )

it("renders a headless group's links with no toggle header, even when not open", () => {
  renderCustom({ label: "Main", headless: true, items: [{ href: "/", label: "Dashboard", icon: Home, show: true }] }, false)
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
  expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument()
})

it("shows the total of visible link badges on the header only while collapsed", () => {
  const badged: NavGroup = {
    label: "Community",
    items: [
      { href: "/families/updates", label: "Family Updates", icon: Home, show: true, badge: 2 },
      { href: "/memberships", label: "Membership Forms", icon: User, show: true, badge: 3 },
      { href: "/hidden", label: "Hidden", icon: User, show: false, badge: 9 },
    ],
  }
  const { unmount } = renderCustom(badged, false)
  expect(screen.getByRole("button", { name: "Community 5 pending" })).toBeInTheDocument()
  unmount()
  renderCustom(badged, true)
  expect(screen.getByRole("button", { name: "Community" })).toBeInTheDocument()
})
