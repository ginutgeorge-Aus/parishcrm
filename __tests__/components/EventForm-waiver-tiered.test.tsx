import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { EventForm } from "@/components/events/EventForm"
import type { ActionResult } from "@/lib/actions/types"

const noopAction = async (_prev: ActionResult): Promise<ActionResult> => undefined

// familyWaiverEnabled and tieredPricingEnabled are mutually exclusive
// (enforced server-side), and each checkbox disables the OTHER whenever it's
// checked. If a row somehow ends up with both flags true (legacy data, a
// direct DB edit), the old `disabled={otherFlag}` logic disabled BOTH
// checkboxes simultaneously with no way to uncheck either from the UI.
describe("EventForm — waiver/tiered mutual exclusion", () => {
  it("disables the tiered checkbox once waiver is checked, and vice versa (normal case)", () => {
    render(<EventForm action={noopAction} defaultValues={{ familyWaiverEnabled: true }} />)
    expect(screen.getByRole("checkbox", { name: /Enable family fee waiver/ })).toBeEnabled()
    expect(screen.getByRole("checkbox", { name: /Tiered family pricing/ })).toBeDisabled()
  })

  it("does not deadlock both checkboxes disabled when a legacy row has both flags true", () => {
    render(
      <EventForm
        action={noopAction}
        defaultValues={{ familyWaiverEnabled: true, tieredPricingEnabled: true }}
      />
    )
    // Both checkboxes must stay enabled so the admin can uncheck either one to
    // escape the invalid state — the old logic disabled both at once here.
    expect(screen.getByRole("checkbox", { name: /Enable family fee waiver/ })).toBeEnabled()
    expect(screen.getByRole("checkbox", { name: /Tiered family pricing/ })).toBeEnabled()
  })

  it("lets an admin escape the deadlocked state by unchecking one box", async () => {
    const user = userEvent.setup()
    render(
      <EventForm
        action={noopAction}
        defaultValues={{ familyWaiverEnabled: true, tieredPricingEnabled: true }}
      />
    )
    const waiverBox = screen.getByRole("checkbox", { name: /Enable family fee waiver/ })
    await user.click(waiverBox)
    expect(waiverBox).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: /Tiered family pricing/ })).toBeEnabled()
  })
})
