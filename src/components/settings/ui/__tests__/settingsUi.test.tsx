/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { SettingsCard } from "@/components/settings/ui/SettingsCard"
import { SettingsRow, settingsDescId, joinDescribedBy } from "@/components/settings/ui/SettingsRow"
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

it("SettingsRow gives the description an id the control can describe itself with", () => {
  render(
    <SettingsRow label="Website" description="Shown on forms" htmlFor="w">
      <input id="w" aria-describedby={settingsDescId("w")} />
    </SettingsRow>,
  )
  expect(screen.getByLabelText("Website")).toHaveAccessibleDescription("Shown on forms")
})

it("SettingsSubgroup renders its heading and rows", () => {
  render(<SettingsSubgroup title="Templates"><SettingsRow label="A"><span /></SettingsRow></SettingsSubgroup>)
  expect(screen.getByRole("heading", { name: "Templates" })).toBeInTheDocument()
  expect(screen.getByText("A")).toBeInTheDocument()
})

it("SettingsRow passes the description id to a render-prop control, so linking is automatic", () => {
  render(
    <SettingsRow label="Website" description="Shown on forms" htmlFor="w">
      {(descId) => <input id="w" aria-describedby={descId} />}
    </SettingsRow>,
  )
  expect(screen.getByLabelText("Website")).toHaveAccessibleDescription("Shown on forms")
})

it("SettingsRow passes no description id when the row has no description", () => {
  const seen = jest.fn(() => <input id="w" />)
  render(<SettingsRow label="Website" htmlFor="w">{seen}</SettingsRow>)
  expect(seen).toHaveBeenCalledWith(undefined)
})

it("SettingsRow stacked variant is a single column at every width", () => {
  const { container } = render(
    <SettingsRow label="Legal" description="hint" htmlFor="l" stacked><textarea id="l" /></SettingsRow>,
  )
  const root = container.firstElementChild as HTMLElement
  expect(root.className).toContain("flex-col")
  expect(root.className).not.toContain("md:flex-row")
  expect(screen.getByText("hint").className).toContain("text-xs") // stacked hints keep the compact size
})

it("joinDescribedBy drops empty ids and returns undefined when none remain", () => {
  expect(joinDescribedBy("a", false, null, undefined, "b")).toBe("a b")
  expect(joinDescribedBy(undefined, false)).toBeUndefined()
})
