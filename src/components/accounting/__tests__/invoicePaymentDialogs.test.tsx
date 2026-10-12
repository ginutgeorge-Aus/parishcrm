import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MarkPaidDialog, UnmarkPaidButton } from "@/components/accounting/MarkPaidDialog"
import { VoidInvoiceDialog } from "@/components/accounting/VoidInvoiceDialog"
import { markInvoicePaid, unmarkInvoicePaid, listPaymentCandidates } from "@/lib/actions/invoicePayment"
import { voidInvoice } from "@/lib/actions/invoiceVoid"

const refresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
jest.mock("@/lib/actions/invoicePayment", () => ({ markInvoicePaid: jest.fn(), unmarkInvoicePaid: jest.fn(), listPaymentCandidates: jest.fn() }))
jest.mock("@/lib/actions/invoiceVoid", () => ({ voidInvoice: jest.fn() }))
jest.mock("@/lib/dates", () => ({ sydneyTodayYMD: () => "2026-10-20" }))

const banks = [{ id: 2, name: "Main" }, { id: 3, name: "Savings" }]
const candidate = { id: 50, date: "2026-10-18", amount: "330.00", reference: "INV-0007", paymentAccountName: "Main" }

let confirmSpy: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true)
  ;(markInvoicePaid as jest.Mock).mockResolvedValue({ success: "INV-0007 marked paid" })
})
afterEach(() => confirmSpy.mockRestore())

const openDialog = () => fireEvent.click(screen.getByRole("button", { name: "Mark paid" }))

describe("MarkPaidDialog", () => {
  it("links a suggested transaction", async () => {
    ;(listPaymentCandidates as jest.Mock).mockResolvedValue([candidate])
    render(<MarkPaidDialog id={11} bankAccounts={banks} hasEmail={false} />)
    openDialog()
    fireEvent.click(await screen.findByLabelText(/2026-10-18/))
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
    await waitFor(() => expect(markInvoicePaid).toHaveBeenCalledWith(11, { mode: "link", transactionId: 50, sendReceipt: false }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(await screen.findByText("INV-0007 marked paid")).toBeTruthy()
  })

  it("asks for a transaction before submitting in link mode", async () => {
    ;(listPaymentCandidates as jest.Mock).mockResolvedValue([candidate])
    render(<MarkPaidDialog id={11} bankAccounts={banks} hasEmail />)
    openDialog()
    await screen.findByLabelText(/2026-10-18/)
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
    expect(await screen.findByText("Choose a transaction")).toBeTruthy()
    expect(markInvoicePaid).not.toHaveBeenCalled()
  })

  it("falls back to recording a new payment when nothing matches, with a receipt", async () => {
    ;(listPaymentCandidates as jest.Mock).mockResolvedValue([])
    render(<MarkPaidDialog id={11} bankAccounts={banks} hasEmail />)
    openDialog()
    const account = await screen.findByLabelText("Bank account")
    fireEvent.change(account, { target: { value: "3" } })
    fireEvent.change(screen.getByLabelText("Payment date"), { target: { value: "2026-10-19" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
    await waitFor(() => expect(markInvoicePaid).toHaveBeenCalledWith(11, { mode: "create", date: "2026-10-19", paymentAccountId: 3, sendReceipt: true }))
  })

  it("treats a candidate lookup failure as no matches", async () => {
    ;(listPaymentCandidates as jest.Mock).mockRejectedValue(new Error("network"))
    render(<MarkPaidDialog id={11} bankAccounts={banks} hasEmail={false} />)
    openDialog()
    expect(await screen.findByLabelText("Bank account")).toBeTruthy()
  })

  it("shows the server error and stays open", async () => {
    ;(listPaymentCandidates as jest.Mock).mockResolvedValue({ error: "Unauthorized" })
    ;(markInvoicePaid as jest.Mock).mockResolvedValue({ error: "Period locked" })
    render(<MarkPaidDialog id={11} bankAccounts={banks} hasEmail={false} />)
    openDialog()
    await screen.findByLabelText("Bank account")
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
    expect(await screen.findByText("Period locked")).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("surfaces a receipt warning after marking paid", async () => {
    ;(listPaymentCandidates as jest.Mock).mockResolvedValue([])
    ;(markInvoicePaid as jest.Mock).mockResolvedValue({ success: "INV-0007 marked paid", warning: "Receipt not sent: no consent" })
    render(<MarkPaidDialog id={11} bankAccounts={banks} hasEmail />)
    openDialog()
    await screen.findByLabelText("Bank account")
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
    expect(await screen.findByText("INV-0007 marked paid. Receipt not sent: no consent")).toBeTruthy()
  })

  it("explains when there is no bank account to record against", async () => {
    ;(listPaymentCandidates as jest.Mock).mockResolvedValue([])
    render(<MarkPaidDialog id={11} bankAccounts={[]} hasEmail={false} />)
    openDialog()
    expect(await screen.findByText(/No active bank account/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
    expect(await screen.findByText("Choose a bank account")).toBeTruthy()
  })
})

describe("UnmarkPaidButton", () => {
  it("unmarks after confirming", async () => {
    ;(unmarkInvoicePaid as jest.Mock).mockResolvedValue({ success: "Payment unlinked — INV-0007 is unpaid again" })
    render(<UnmarkPaidButton id={11} />)
    fireEvent.click(screen.getByRole("button", { name: "Unmark paid" }))
    expect(await screen.findByText("Payment unlinked — INV-0007 is unpaid again")).toBeTruthy()
    expect(unmarkInvoicePaid).toHaveBeenCalledWith(11)
  })
  it("shows an error", async () => {
    ;(unmarkInvoicePaid as jest.Mock).mockResolvedValue({ error: "Period locked" })
    render(<UnmarkPaidButton id={11} />)
    fireEvent.click(screen.getByRole("button", { name: "Unmark paid" }))
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Period locked")
  })
  it("does nothing when not confirmed", () => {
    confirmSpy.mockReturnValue(false)
    render(<UnmarkPaidButton id={11} />)
    fireEvent.click(screen.getByRole("button", { name: "Unmark paid" }))
    expect(unmarkInvoicePaid).not.toHaveBeenCalled()
  })
})

describe("VoidInvoiceDialog", () => {
  const openVoid = () => fireEvent.click(screen.getByRole("button", { name: "Void" }))
  it("needs a reason, then voids and refreshes", async () => {
    ;(voidInvoice as jest.Mock).mockResolvedValue({ success: "INV-0007 voided" })
    render(<VoidInvoiceDialog id={11} />)
    openVoid()
    const submit = screen.getByRole("button", { name: "Void invoice" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Duplicate" } })
    fireEvent.click(submit)
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledWith(11, "Duplicate"))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
  it("shows the server error", async () => {
    ;(voidInvoice as jest.Mock).mockResolvedValue({ error: "Unmark the payment before voiding" })
    render(<VoidInvoiceDialog id={11} />)
    openVoid()
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Void invoice" }))
    expect(await screen.findByText("Unmark the payment before voiding")).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })
})
