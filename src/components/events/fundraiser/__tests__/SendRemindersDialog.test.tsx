import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SendRemindersDialog } from "@/components/events/fundraiser/SendRemindersDialog"
import { sendFundraiserReminders } from "@/lib/actions/fundraiser"

jest.mock("@/lib/actions/fundraiser", () => ({ sendFundraiserReminders: jest.fn() }))

/** Render the dialog and open it. */
function open(props: Partial<{ sendable: number; skippedNoEmail: number; lastSentAt: string | null }> = {}) {
  render(<SendRemindersDialog fundraiserId={4} sendable={3} skippedNoEmail={0} lastSentAt={null} {...props} />)
  fireEvent.click(screen.getByRole("button", { name: "Send reminders" }))
}

/** The in-dialog confirm button (last match; the trigger may also be in the DOM). */
const confirmBtn = () => screen.getAllByRole("button", { name: /^(Send reminders|Sending…)$/ }).at(-1)!

beforeEach(() => jest.clearAllMocks())

describe("SendRemindersDialog", () => {
  it("shows counts, skipped note and never-sent label", () => {
    open({ sendable: 3, skippedNoEmail: 2 })
    expect(screen.getByText("This will email 3 people who still owe money.")).toBeInTheDocument()
    expect(screen.getByText(/2 people owe money but have no email/)).toBeInTheDocument()
    expect(screen.getByText("No reminders have been sent yet.")).toBeInTheDocument()
  })

  it("uses singular wording and last-sent date", () => {
    open({ sendable: 1, skippedNoEmail: 1, lastSentAt: "1 Nov 2026" })
    expect(screen.getByText("This will email 1 person who still owe money.")).toBeInTheDocument()
    expect(screen.getByText(/1 person owes money but has no email/)).toBeInTheDocument()
    expect(screen.getByText("Reminders were last sent on 1 Nov 2026.")).toBeInTheDocument()
  })

  it("disables send when nobody can be reminded", () => {
    open({ sendable: 0 })
    expect(screen.getByText("Nobody can be reminded right now.")).toBeInTheDocument()
    expect(confirmBtn()).toBeDisabled()
  })

  it("sends and shows result with failures, then closes", async () => {
    ;(sendFundraiserReminders as jest.Mock).mockResolvedValue({ sent: 2, failed: 1 })
    open()
    fireEvent.click(confirmBtn())
    expect(await screen.findByText("Sent 2 reminders, 1 failed.")).toBeInTheDocument()
    expect(sendFundraiserReminders).toHaveBeenCalledWith(4)
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0])
    await waitFor(() => expect(screen.queryByText("Sent 2 reminders, 1 failed.")).toBeNull())
  })

  it("uses singular sent wording", async () => {
    ;(sendFundraiserReminders as jest.Mock).mockResolvedValue({ sent: 1, failed: 0 })
    open()
    fireEvent.click(confirmBtn())
    expect(await screen.findByText("Sent 1 reminder.")).toBeInTheDocument()
  })

  it("shows server error and cancel closes", async () => {
    ;(sendFundraiserReminders as jest.Mock).mockResolvedValue({ error: "Not allowed" })
    open()
    fireEvent.click(confirmBtn())
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByText("Send payment reminders")).toBeNull())
  })
})

describe("SendRemindersDialog thrown action", () => {
  it("shows a generic error when the action throws", async () => {
    ;(sendFundraiserReminders as jest.Mock).mockRejectedValue(new Error("boom"))
    open()
    fireEvent.click(confirmBtn())
    expect(await screen.findByText("Could not send reminders. Please try again.")).toBeInTheDocument()
  })
})
