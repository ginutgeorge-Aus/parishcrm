import { render, screen } from "@testing-library/react"
import { SettingsNav, SETTINGS_NAV_ITEMS } from "@/components/settings/SettingsNav"

describe("SettingsNav", () => {
  it("renders a labelled nav with an anchor per section", () => {
    render(<SettingsNav />)
    const nav = screen.getByRole("navigation", { name: "Settings sections" })
    expect(nav).toBeInTheDocument()
    for (const { id, label } of SETTINGS_NAV_ITEMS) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", `#${id}`)
    }
  })

  it("covers the six groups in order", () => {
    expect(SETTINGS_NAV_ITEMS.map((i) => i.label)).toEqual([
      "General",
      "Branding",
      "Email",
      "Members",
      "Receipts",
      "Security",
    ])
  })
})
