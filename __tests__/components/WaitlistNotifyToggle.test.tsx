import { render, screen, fireEvent } from "@testing-library/react"
import { WaitlistNotifyToggle } from "@/components/events/WaitlistNotifyToggle"
import { markWaitlistNotified } from "@/lib/actions/waitlist"

jest.mock("@/lib/actions/waitlist", () => ({ markWaitlistNotified: jest.fn() }))

describe("WaitlistNotifyToggle — prop re-sync", () => {
  // Before the fix, `optimistic` was seeded once via useState(notified) and
  // never re-synced, so a server-side change (another admin / revalidation)
  // left the badge stale while the row stayed mounted.
  it("reflects a server-side notified change on re-render without remounting", () => {
    const { rerender } = render(
      <WaitlistNotifyToggle id={1} eventId={2} notified={false} canEdit />
    )
    expect(screen.getByText("Pending")).toBeInTheDocument()

    rerender(<WaitlistNotifyToggle id={1} eventId={2} notified={true} canEdit />)
    expect(screen.getByText("Notified")).toBeInTheDocument()
    expect(screen.queryByText("Pending")).not.toBeInTheDocument()
  })
})

describe("WaitlistNotifyToggle — failed update", () => {
  // Before the fix, only a resolved { error } branch rolled back the optimistic
  // badge; a rejected action left the badge showing the wrong (newly toggled)
  // status with no error surfaced.
  it("rolls back the badge and shows an inline error when the action rejects", async () => {
    ;(markWaitlistNotified as jest.Mock).mockRejectedValue(new Error("network"))
    render(<WaitlistNotifyToggle id={1} eventId={2} notified={false} canEdit />)

    fireEvent.click(screen.getByRole("button"))

    // rejection → previous value restored + inline error
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()
    expect(screen.queryByText("Notified")).not.toBeInTheDocument()
  })
})
