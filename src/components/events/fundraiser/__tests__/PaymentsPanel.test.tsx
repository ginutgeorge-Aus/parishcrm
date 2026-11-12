import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PaymentsPanel, type PaymentItem } from "@/components/events/fundraiser/PaymentsPanel"
import { recordPayment, deletePayment } from "@/lib/actions/fundraiser"

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

  it("deletes a payment and shows delete error", async () => {
    ;(deletePayment as jest.Mock).mockResolvedValueOnce({ success: "ok" }).mockResolvedValueOnce({ error: "Locked" })
    openPanel()
    const del = screen.getByRole("button", { name: /Delete payment/ })
    fireEvent.click(del)
    await waitFor(() => expect(deletePayment).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByRole("button", { name: /Delete payment/ })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /Delete payment/ }))
    await waitFor(() => expect(deletePayment).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole("alert")).toHaveTextContent("Locked")
  })
})
