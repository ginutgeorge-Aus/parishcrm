import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TieredPricingEditor } from "@/components/events/TieredPricingEditor"

describe("TieredPricingEditor", () => {
  // Regression: the editor is kept mounted but display:none when tiered pricing
  // is off. A `required` tier price input left enabled while hidden
  // makes the browser refuse to submit the whole event form — it cannot focus a
  // hidden required control ("An invalid form control ... is not focusable").
  // Disabling the input when inactive excludes it from HTML5 validation and from
  // FormData (the server ignores tier fields unless tiered pricing is enabled).
  it("disables the tier price input when the section is inactive", () => {
    render(<TieredPricingEditor defaultTiers={[]} active={false} />)
    expect(screen.getByLabelText(/Price for 1 attendee/)).toBeDisabled()
  })

  it("enables and requires the tier price input when active", () => {
    render(<TieredPricingEditor defaultTiers={[]} active={true} />)
    const input = screen.getByLabelText(/Price for 1 attendee/)
    expect(input).toBeEnabled()
    expect(input).toBeRequired()
  })

  // every Remove button announced identically as "Remove" to a screen
  // reader regardless of which row it belonged to.
  it("gives each Remove button a row-distinguishing accessible name", async () => {
    const user = userEvent.setup()
    render(<TieredPricingEditor defaultTiers={["10", "20"]} active={true} />)
    expect(screen.getByRole("button", { name: "Remove tier (row 1)" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Remove tier (row 2)" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add tier" }))
    expect(screen.getByRole("button", { name: "Remove tier (row 3)" })).toBeInTheDocument()
  })

  // removing the last tier row was a silent no-op — the Remove button
  // stayed enabled but the click did nothing, reading as a broken button
  // rather than the intentional "at least one tier" minimum.
  it("disables the Remove button when only one tier row remains", () => {
    render(<TieredPricingEditor defaultTiers={[]} active={true} />)
    expect(screen.getByRole("button", { name: "Remove tier (row 1)" })).toBeDisabled()
  })

  it("enables Remove once a second tier row is added, and re-disables it after removing back down to one", async () => {
    const user = userEvent.setup()
    render(<TieredPricingEditor defaultTiers={[]} active={true} />)
    await user.click(screen.getByRole("button", { name: "Add tier" }))
    const removeButtons = screen.getAllByRole("button", { name: /^Remove tier/ })
    expect(removeButtons).toHaveLength(2)
    expect(removeButtons[0]).toBeEnabled()
    expect(removeButtons[1]).toBeEnabled()

    await user.click(removeButtons[0])
    expect(screen.getByRole("button", { name: /^Remove tier/ })).toBeDisabled()
  })
})
