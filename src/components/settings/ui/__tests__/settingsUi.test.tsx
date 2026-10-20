/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { SettingsCard } from "@/components/settings/ui/SettingsCard"
import { SettingsRow } from "@/components/settings/ui/SettingsRow"
import { SettingsSubgroup } from "@/components/settings/ui/SettingsSubgroup"

it("SettingsCard renders a labelled section with title, description, body and footer", () => {
  render(
    <SettingsCard title="General" description="Church details" footer={<button>Save</button>}>
      <p>body</p>
    </SettingsCard>,
  )
  const card = screen.getByRole("region", { name: "General" })
  expect(card).toContainElement(screen.getByRole("heading", { name: "General" }))
  expect(card).toHaveTextContent("Church details")
  expect(card).toContainElement(screen.getByRole("button", { name: "Save" }))
})

it("SettingsCard omits the footer when none is given", () => {
  const { container } = render(<SettingsCard title="X"><p>b</p></SettingsCard>)
  expect(container.querySelectorAll("section > div")).toHaveLength(2) // header + body
})

it("SettingsRow associates its label with the control", () => {
  render(<SettingsRow label="Church name" description="On receipts" htmlFor="n"><input id="n" /></SettingsRow>)
  expect(screen.getByLabelText("Church name")).toBeInTheDocument()
  expect(screen.getByText("On receipts")).toBeInTheDocument()
})

it("SettingsSubgroup renders its heading and rows", () => {
  render(<SettingsSubgroup title="Templates"><SettingsRow label="A"><span /></SettingsRow></SettingsSubgroup>)
  expect(screen.getByRole("heading", { name: "Templates" })).toBeInTheDocument()
  expect(screen.getByText("A")).toBeInTheDocument()
})
