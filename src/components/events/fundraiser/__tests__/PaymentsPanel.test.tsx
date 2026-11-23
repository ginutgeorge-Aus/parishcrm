import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { PaymentsPanel } from "@/components/events/fundraiser/PaymentsPanel"
import type { FundraiserPaymentItem as PaymentItem } from "@/lib/fundraiserQueries"
import { ALREADY_RECORDED_ERROR } from "@/lib/fundraiserErrors"
import { recordPayment, deletePayment } from "@/lib/actions/fundraiser"

const refresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), unstable_rethrow: jest.fn() }))
jest.mock("@/lib/actions/fundraiser", () => ({ recordPayment: jest.fn(), deletePayment: jest.fn() }))

const payments: PaymentItem[] = [
  { id: 1, amountCents: 2000, method: "CASH", paidAt: "2026-11-01", note: "front desk" },
  { id: 2, amountCents: 3000, method: "ONLINE", paidAt: "2026-11-02", note: null },
]

/** Render the panel and open its dialog. */
function openPanel(remainingCents = 5000, items: PaymentItem[] = payments) {
  render(<PaymentsPanel entryId={9} name="Example Family" remainingCents={remainingCents} payments={items} />)
  fireEvent.click(screen.getByRole("button", { name: "Payments for Example Family" }))
}

beforeEach(() => jest.clearAllMocks())

describe("PaymentsPanel", () => {
  it("refreshes the list after the already-recorded error, keeping the key", async () => {
    ;(recordPayment as jest.Mock).mockResolvedValue({ error: ALREADY_RECORDED_ERROR })
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole("button", { name: "Record payment" }))
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(2))
    const keys = (recordPayment as jest.Mock).mock.calls.map((c) => c[1].submissionKey)
    expect(keys[0]).toEqual(expect.any(String))
    expect(keys[0].length).toBeGreaterThan(0)
    expect(keys[0]).toBe(keys[1])
  })

  it("lists payments, defaults amount to remaining, hides delete for ONLINE", () => {
    openPanel()
    expect(screen.getByText(/CASH · 2026-11-01 · front desk/)).toBeInTheDocument()
    expect(screen.getByText("Refund in Stripe")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /Delete payment/ })).toHaveLength(1)
    expect(screen.getByLabelText("Amount")).toHaveValue("50.00")
  })

  it("shows empty state and blank amount when nothing is owed", () => {
    openPanel(0, [])
    expect(screen.getByText("No payments yet.")).toBeInTheDocument()
    expect(screen.getByLabelText("Amount")).toHaveValue("")
  })

  it("records a payment and resets the form", async () => {
    ;(recordPayment as jest.Mock).mockResolvedValue({ success: "ok" })
    openPanel()
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "BANK" } })
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "ref 1" } })
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }))
    await waitFor(() => expect(recordPayment).toHaveBeenCalledWith(9, expect.objectContaining({
      amount: "50.00", method: "BANK", note: "ref 1", submissionKey: expect.any(String),
    })))
    await waitFor(() => expect(screen.getByLabelText("Amount")).toHaveValue(""))
  })

  it("shows record error", async () => {
    ;(recordPayment as jest.Mock).mockResolvedValue({ error: "Amount too high" })
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Amount too high")
  })

  /** Clicks the row Delete trigger, then (optionally) the dialog's confirm button. */
  async function clickDelete(confirm = true) {
    fireEvent.click(screen.getByRole("button", { name: /Delete payment/ }))
    const dialog = await screen.findByRole("alertdialog")
    if (confirm) fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    return dialog
  }

  it("does not delete on the first click, only after confirming", async () => {
    ;(deletePayment as jest.Mock).mockResolvedValue({ success: "ok" })
    openPanel()
    await clickDelete(false)
    expect(deletePayment).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(deletePayment).toHaveBeenCalledWith(1))
  })

  it("shows the delete error inside the confirm dialog", async () => {
    ;(deletePayment as jest.Mock).mockResolvedValue({ error: "Locked" })
    openPanel()
    const dialog = await clickDelete()
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Locked")
  })

  it("shows an inline error when recording a payment throws", async () => {
    ;(recordPayment as jest.Mock).mockRejectedValue(new Error("network"))
    openPanel()
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not record the payment. Please try again.")
  })

  it("shows an inline error when deleting a payment throws", async () => {
    ;(deletePayment as jest.Mock).mockRejectedValue(new Error("network"))
    openPanel()
    const dialog = await clickDelete()
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong. Try again.")
  })
})
