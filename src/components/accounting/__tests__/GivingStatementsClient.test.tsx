import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { GivingStatementsClient } from "@/components/accounting/GivingStatementsClient"
import { sendGivingStatements, type StatementListRow } from "@/lib/actions/givingStatement"

jest.mock("@/lib/actions/givingStatement", () => ({ sendGivingStatements: jest.fn() }))

const send = sendGivingStatements as jest.Mock

const row = (over: Partial<StatementListRow>): StatementListRow => ({
  familyId: 1, familyName: "Smith", giftCount: 2, total: 150, canEmail: true, lastStatus: null, lastAt: null, ...over,
})
const rows = [
  row({}),
  row({ familyId: 2, familyName: "Jones", canEmail: false }),
  row({ familyId: 3, familyName: "Brown", lastStatus: "SENT", lastAt: new Date("2026-07-01T00:00:00Z") }),
  row({ familyId: 4, familyName: "Green", lastStatus: "FAILED", lastAt: new Date("2026-07-02T00:00:00Z") }),
]

beforeEach(() => jest.clearAllMocks())

describe("GivingStatementsClient", () => {
  it("hides send controls for read-only users and links the PDF preview", () => {
    render(<GivingStatementsClient year={2025} rows={rows} canManage={false} />)
    expect(screen.queryByRole("button", { name: /email selected/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /preview pdf/i })[0]).toHaveAttribute(
      "href",
      "/accounting/giving-statements/1/pdf?year=2025"
    )
  })

  it("disables rows without email and selects only unsent families with Select all unsent", async () => {
    const user = userEvent.setup()
    render(<GivingStatementsClient year={2025} rows={rows} canManage />)
    expect(screen.getAllByLabelText("Select Jones")[0]).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /select all unsent/i }))
    expect(screen.getByRole("button", { name: "Email selected (2)" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: /select all unsent/i }))
    expect(screen.getByRole("button", { name: "Email selected (0)" })).toBeDisabled()
  })

  it("toggles a single family", async () => {
    const user = userEvent.setup()
    render(<GivingStatementsClient year={2025} rows={rows} canManage />)
    const box = screen.getAllByLabelText("Select Smith")[0]
    await user.click(box)
    expect(box).toBeChecked()
    await user.click(box)
    expect(box).not.toBeChecked()
  })

  it("sends, summarises, lists per-family errors keyed by family and clears the selection", async () => {
    send.mockResolvedValue({
      sent: 1, failed: 1, skipped: 1,
      errors: [{ familyId: 4, error: "Email delivery failed" }],
    })
    const user = userEvent.setup()
    render(<GivingStatementsClient year={2025} rows={rows} canManage />)
    await user.click(screen.getByRole("button", { name: /select all unsent/i }))
    await user.click(screen.getByRole("button", { name: /email selected/i }))
    await waitFor(() => expect(screen.getByText(/Sent 1, failed 1, skipped 1 already sent/)).toBeInTheDocument())
    expect(send).toHaveBeenCalledWith(2025, [1, 4], true)
    expect(screen.getByText("Green: Email delivery failed")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Email selected (0)" })).toBeInTheDocument()
  })

  it("passes skipAlreadySent=false when resend is ticked", async () => {
    send.mockResolvedValue({ sent: 1, failed: 0, skipped: 0, errors: [] })
    const user = userEvent.setup()
    render(<GivingStatementsClient year={2025} rows={rows} canManage />)
    await user.click(screen.getByLabelText(/resend to families already sent/i))
    await user.click(screen.getAllByLabelText("Select Brown")[0])
    await user.click(screen.getByRole("button", { name: /email selected/i }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(2025, [3], false))
  })

  it("reports a fatal error and keeps the selection", async () => {
    send.mockResolvedValue({ error: "Unauthorized" })
    const user = userEvent.setup()
    render(<GivingStatementsClient year={2025} rows={rows} canManage />)
    await user.click(screen.getAllByLabelText("Select Smith")[0])
    await user.click(screen.getByRole("button", { name: /email selected/i }))
    await waitFor(() => expect(screen.getByText(/Stopped early: Unauthorized/)).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Email selected (1)" })).toBeInTheDocument()
  })

  it("shows a generic message when the action throws", async () => {
    send.mockRejectedValue(new Error("boom"))
    const user = userEvent.setup()
    render(<GivingStatementsClient year={2025} rows={rows} canManage />)
    await user.click(screen.getAllByLabelText("Select Smith")[0])
    await user.click(screen.getByRole("button", { name: /email selected/i }))
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })
})
