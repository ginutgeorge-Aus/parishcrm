import { render, screen } from "@testing-library/react"
import { Home } from "lucide-react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarLink } from "@/components/layout/sidebar/SidebarLink"

const item = { href: "/", label: "Dashboard", icon: Home, show: true, badge: 3 }

it("shows label and numeric badge when expanded", () => {
  render(
    <TooltipProvider>
      <SidebarLink item={item} active={false} collapsed={false} onNavigate={() => {}} />
    </TooltipProvider>
  )
  expect(screen.getByText("Dashboard")).toBeInTheDocument()
  expect(screen.getByText("3")).toBeInTheDocument()
})

it("hides the label and shows a badge dot instead of the number when collapsed", () => {
  render(
    <TooltipProvider>
      <SidebarLink item={item} active={false} collapsed={true} onNavigate={() => {}} />
    </TooltipProvider>
  )
  expect(screen.queryByText("Dashboard")).not.toBeInTheDocument()
  expect(screen.queryByText("3")).not.toBeInTheDocument()
  expect(screen.getByRole("link").querySelector(".bg-warning")).toBeInTheDocument()
})

it("wraps the link in a tooltip trigger only when collapsed", () => {
  const { rerender } = render(
    <TooltipProvider>
      <SidebarLink item={item} active={false} collapsed={false} onNavigate={() => {}} />
    </TooltipProvider>
  )
  expect(screen.getByRole("link").closest('[data-slot="tooltip-trigger"]')).toBeNull()

  rerender(
    <TooltipProvider>
      <SidebarLink item={item} active={false} collapsed={true} onNavigate={() => {}} />
    </TooltipProvider>
  )
  expect(screen.getByRole("link").closest('[data-slot="tooltip-trigger"]')).not.toBeNull()
})

it("gives an informational badge a neutral tone, not the amber action colour", () => {
  const info = { ...item, badgeInformational: true }
  const { rerender } = render(
    <TooltipProvider>
      <SidebarLink item={info} active={false} collapsed={false} onNavigate={() => {}} />
    </TooltipProvider>
  )
  expect(screen.getByText("3")).not.toHaveClass("bg-warning")

  rerender(
    <TooltipProvider>
      <SidebarLink item={info} active={false} collapsed={true} onNavigate={() => {}} />
    </TooltipProvider>
  )
  expect(screen.getByRole("link").querySelector(".bg-warning")).toBeNull()
})

it("marks the active link with the primary pill, not a gold border", () => {
  render(
    <TooltipProvider>
      <SidebarLink item={item} active={true} collapsed={false} onNavigate={() => {}} />
    </TooltipProvider>
  )
  const link = screen.getByRole("link")
  expect(link).toHaveAttribute("aria-current", "page")
  expect(link).toHaveClass("bg-primary/10", "text-primary")
  expect(link).not.toHaveClass("border-gold")
})
