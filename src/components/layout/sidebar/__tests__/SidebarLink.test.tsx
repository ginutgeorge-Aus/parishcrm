import { render, screen } from "@testing-library/react"
import { ListTodo } from "lucide-react"
import { SidebarLink } from "../SidebarLink"

const base = { href: "/follow-ups", label: "Follow-ups", icon: ListTodo, show: true, attentionHref: "/follow-ups?assignee=mine" }

describe("SidebarLink", () => {
  it("links to attentionHref while a badge is showing", () => {
    render(<SidebarLink item={{ ...base, badge: 3 }} active={false} collapsed={false} onNavigate={() => {}} />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/follow-ups?assignee=mine")
  })

  it("links to href when there is no badge", () => {
    render(<SidebarLink item={{ ...base, badge: 0 }} active={false} collapsed={false} onNavigate={() => {}} />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/follow-ups")
  })
})
