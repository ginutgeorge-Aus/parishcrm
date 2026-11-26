import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { SendRemindersDialog } from "@/components/events/fundraiser/SendRemindersDialog"
import { getReminderPlan, sendFundraiserReminders } from "@/lib/actions/fundraiser"

jest.mock("@/lib/actions/fundraiser", () => ({ sendFundraiserReminders: jest.fn(), getReminderPlan: jest.fn() }))

/** Render the dialog, open it and wait for the lazily loaded counts. */
async function open(props: Partial<{ sendable: number; skippedNoEmail: number; skippedRecent: number; deferred: number; dedupeMinutes: number; lastSentAt: string | null }> = {}) {
  ;(getReminderPlan as jest.Mock).mockResolvedValue({ sendable: 3, skippedNoEmail: 0, skippedRecent: 0, deferred: 0, dedupeMinutes: 10, lastSentAt: null, ...props })
  render(<SendRemindersDialog fundraiserId={4} />)
  fireEvent.click(screen.getByRole("button", { name: "Send reminders" }))
  await screen.findByText(/Reminders were last sent|No reminders have been sent yet/)
}

/** The in-dialog confirm button (last match; the trigger may also be in the DOM). */
const confirmBtn = () => screen.getAllByRole("button", { name: /^(Send reminders|Sending…)$/ }).at(-1)!

beforeEach(() => jest.clearAllMocks())

describe("SendRemindersDialog", () => {
  it("shows counts, skipped note and never-sent label", async () => {
    await open({ sendable: 3, skippedNoEmail: 2 })
    expect(screen.getByText("This will email up to 3 people who still owe money.")).toBeInTheDocument()
    expect(screen.getByText(/2 people owe money but have no email/)).toBeInTheDocument()
    expect(screen.getByText("No reminders have been sent yet.")).toBeInTheDocument()
  })

  it("uses singular wording and last-sent date", async () => {
    await open({ sendable: 1, skippedNoEmail: 1, lastSentAt: "1 Nov 2026" })
    expect(screen.getByText("This will email up to 1 person who still owes money.")).toBeInTheDocument()
    expect(screen.getByText(/1 person owes money but has no email/)).toBeInTheDocument()
    expect(screen.getByText("Reminders were last sent on 1 Nov 2026.")).toBeInTheDocument()
  })

  it("says 'up to N' for any send, since the send recomputes the plan and the time budget may stop it early", async () => {
    await open({ sendable: 200, deferred: 5 })
    expect(screen.getByText("This will email up to 200 people who still owe money.")).toBeInTheDocument()
  })

  it("tells the user a run can stop early and to run again when sendable is large", async () => {
    await open({ sendable: 150, deferred: 0 })
    expect(screen.getByText("Each run has a time limit. If some people are left, run it again to continue.")).toBeInTheDocument()
  })

  it("hides the time-limit notice for a small run with nothing deferred", async () => {
    await open({ sendable: 3, deferred: 0 })
    expect(screen.queryByText(/Each run has a time limit/)).not.toBeInTheDocument()
  })

  it("shows the time-limit notice alongside the batch note when some are deferred", async () => {
    await open({ sendable: 200, deferred: 5 })
    expect(screen.getByText(/5 more people will be left for later runs/)).toBeInTheDocument()
    expect(screen.getByText(/Each run has a time limit/)).toBeInTheDocument()
  })

  it("disables send when nobody can be reminded", async () => {
    await open({ sendable: 0 })
    expect(screen.getByText("Nobody can be reminded right now.")).toBeInTheDocument()
    expect(confirmBtn()).toBeDisabled()
  })

  it("sends and shows result with failures, then closes", async () => {
    ;(sendFundraiserReminders as jest.Mock).mockResolvedValue({ sent: 2, failed: 1 })
    await open()
    fireEvent.click(confirmBtn())
    expect(await screen.findByText("Sent 2 reminders, 1 failed.")).toBeInTheDocument()
    expect(sendFundraiserReminders).toHaveBeenCalledWith(4)
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0])
    await waitFor(() => expect(screen.queryByText("Sent 2 reminders, 1 failed.")).toBeNull())
  })

  it("previews recently-reminded and deferred counts using the server's window", async () => {
    await open({ skippedRecent: 2, deferred: 1, dedupeMinutes: 15 })
    expect(screen.getByText("2 people were reminded in the last 15 minutes, so will be skipped.")).toBeInTheDocument()
    expect(screen.getByText("Reminders go out in batches: 1 more person will be left for later runs.")).toBeInTheDocument()
  })

  it("reports skippedRecent and deferred in the send result", async () => {
    ;(sendFundraiserReminders as jest.Mock).mockResolvedValue({ sent: 2, failed: 0, skippedRecent: 3, deferred: 4 })
    await open({ dedupeMinutes: 10 })
    fireEvent.click(confirmBtn())
    expect(await screen.findByText("Sent 2 reminders, 3 skipped (reminded in the last 10 minutes). 4 more not sent yet: run again to continue.")).toBeInTheDocument()
  })

  it("ignores a send result that lands after the dialog was reopened", async () => {
    let resolveSend: (v: unknown) => void = () => {}
    ;(sendFundraiserReminders as jest.Mock).mockImplementationOnce(() => new Promise((r) => { resolveSend = r }))
    await open()
    fireEvent.click(confirmBtn())
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Send reminders" }))
    await screen.findByText(/Reminders were last sent|No reminders have been sent yet/)
    await act(async () => { resolveSend({ sent: 9, failed: 0, skippedRecent: 0, deferred: 0 }) })
    expect(screen.queryByText(/Sent 9 reminders/)).toBeNull()
    // The late send may have emailed people, so the preview is refreshed (open + reopen + refresh).
    expect(getReminderPlan).toHaveBeenCalledTimes(3)
  })

  it("uses singular sent wording", async () => {
    ;(sendFundraiserReminders as jest.Mock).mockResolvedValue({ sent: 1, failed: 0 })
    await open()
    fireEvent.click(confirmBtn())
    expect(await screen.findByText("Sent 1 reminder.")).toBeInTheDocument()
  })

  it("shows server error and cancel closes", async () => {
    ;(sendFundraiserReminders as jest.Mock).mockResolvedValue({ error: "Not allowed" })
    await open()
    fireEvent.click(confirmBtn())
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByText("Send payment reminders")).toBeNull())
  })
})

describe("SendRemindersDialog thrown action", () => {
  it("shows a generic error when the action throws", async () => {
    ;(sendFundraiserReminders as jest.Mock).mockRejectedValue(new Error("boom"))
    await open()
    fireEvent.click(confirmBtn())
    expect(await screen.findByText("Could not send reminders. Please try again.")).toBeInTheDocument()
  })
})

describe("SendRemindersDialog lazy plan", () => {
  it("loads counts only when opened, for this fundraiser", async () => {
    ;(getReminderPlan as jest.Mock).mockResolvedValue({ sendable: 2, skippedNoEmail: 0, lastSentAt: null })
    render(<SendRemindersDialog fundraiserId={4} />)
    expect(getReminderPlan).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Send reminders" }))
    expect(await screen.findByText("This will email up to 2 people who still owe money.")).toBeInTheDocument()
    expect(getReminderPlan).toHaveBeenCalledWith(4)
  })

  it("ignores a slow plan response from an earlier open (no stale overwrite)", async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    ;(getReminderPlan as jest.Mock)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce({ sendable: 2, skippedNoEmail: 0, lastSentAt: null })
    render(<SendRemindersDialog fundraiserId={4} />)
    fireEvent.click(screen.getByRole("button", { name: "Send reminders" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Send reminders" }))
    expect(await screen.findByText("This will email up to 2 people who still owe money.")).toBeInTheDocument()
    await act(async () => { resolveFirst({ sendable: 9, skippedNoEmail: 0, lastSentAt: null }) })
    expect(screen.queryByText(/This will email up to 9 people/)).toBeNull()
    expect(screen.getByText("This will email up to 2 people who still owe money.")).toBeInTheDocument()
  })

  it("shows the plan error and keeps send disabled", async () => {
    ;(getReminderPlan as jest.Mock).mockResolvedValue({ error: "Unauthorized" })
    render(<SendRemindersDialog fundraiserId={4} />)
    fireEvent.click(screen.getByRole("button", { name: "Send reminders" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized")
    expect(confirmBtn()).toBeDisabled()
  })
})
