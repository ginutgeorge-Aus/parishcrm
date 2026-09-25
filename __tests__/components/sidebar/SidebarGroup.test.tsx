import { render, screen, fireEvent } from "@testing-library/react"
import { Home, User } from "lucide-react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarGroup } from "@/components/layout/sidebar/SidebarGroup"
import type { NavGroup } from "@/components/layout/sidebar/navData"

const group: NavGroup = {
  label: "Accounting",
  basePath: "/accounting",
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

function renderGroup(isOpen: boolean, onToggle = () => {}) {
  return render(
    <TooltipProvider>
      <SidebarGroup
        group={group}
        isOpen={isOpen}
        hasActive={false}
        isActive={() => false}
        onToggle={onToggle}
        onNavigate={() => {}}
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
  expect(screen.queryByText("Overview")).not.toBeInTheDocument()
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
