import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { DeleteDraftButton } from "@/components/accounting/InvoiceRowActions"
import { InvoiceSendActions } from "@/components/accounting/InvoiceSendActions"
import { InvoiceSettingsForm } from "@/components/accounting/InvoiceSettingsForm"
import { deleteDraftInvoice } from "@/lib/actions/invoice"
import { sendInvoice, markInvoiceSent, resendInvoice } from "@/lib/actions/invoiceSend"
import { updateInvoiceSettings } from "@/lib/actions/invoiceSettings"

const push = jest.fn()
const refresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))
jest.mock("@/lib/actions/invoice", () => ({ deleteDraftInvoice: jest.fn() }))
jest.mock("@/lib/actions/invoiceSend", () => ({ sendInvoice: jest.fn(), markInvoiceSent: jest.fn(), resendInvoice: jest.fn() }))
jest.mock("@/lib/actions/invoiceSettings", () => ({ updateInvoiceSettings: jest.fn() }))

let confirmSpy: jest.SpyInstance
let alertSpy: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true)
  alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {})
})
afterEach(() => { confirmSpy.mockRestore(); alertSpy.mockRestore() })

describe("DeleteDraftButton", () => {
  it("deletes and returns to the list", async () => {
    ;(deleteDraftInvoice as jest.Mock).mockResolvedValue({ success: "Draft deleted" })
    render(<DeleteDraftButton id={11} />)
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/accounting/invoices"))
    expect(deleteDraftInvoice).toHaveBeenCalledWith(11)
  })
  it("alerts on error and stays", async () => {
    ;(deleteDraftInvoice as jest.Mock).mockResolvedValue({ error: "Only unnumbered draft invoices can be deleted" })
    render(<DeleteDraftButton id={11} />)
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }))
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Only unnumbered draft invoices can be deleted"))
    expect(push).not.toHaveBeenCalled()
  })
  it("does nothing when not confirmed", () => {
    confirmSpy.mockReturnValue(false)
    render(<DeleteDraftButton id={11} />)
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }))
    expect(deleteDraftInvoice).not.toHaveBeenCalled()
  })
})

describe("InvoiceSendActions", () => {
  it("sends a draft by email and shows the result", async () => {
    ;(sendInvoice as jest.Mock).mockResolvedValue({ success: "Invoice INV-0007 emailed" })
    render(<InvoiceSendActions id={11} status="DRAFT" hasEmail />)
    fireEvent.click(screen.getByRole("button", { name: "Send by email" }))
    expect(await screen.findByRole("status")).toHaveTextContent("Invoice INV-0007 emailed")
    expect(refresh).toHaveBeenCalled()
  })
  it("disables email send without an address but allows mark as sent", async () => {
    ;(markInvoiceSent as jest.Mock).mockResolvedValue({ error: "Church ABN not configured" })
    render(<InvoiceSendActions id={11} status="DRAFT" hasEmail={false} />)
    expect(screen.getByRole("button", { name: "Send by email" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /Mark as sent/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Church ABN not configured")
  })
  it("re-sends a sent invoice", async () => {
    ;(resendInvoice as jest.Mock).mockResolvedValue({ success: "Invoice INV-0007 re-sent" })
    render(<InvoiceSendActions id={11} status="SENT" hasEmail />)
    fireEvent.click(screen.getByRole("button", { name: "Re-send" }))
    expect(await screen.findByRole("status")).toHaveTextContent("re-sent")
  })
  it("skips the action when not confirmed", () => {
    confirmSpy.mockReturnValue(false)
    render(<InvoiceSendActions id={11} status="SENT" hasEmail />)
    fireEvent.click(screen.getByRole("button", { name: "Re-send" }))
    expect(resendInvoice).not.toHaveBeenCalled()
  })
})

describe("InvoiceSettingsForm", () => {
  it("saves both settings", async () => {
    ;(updateInvoiceSettings as jest.Mock).mockResolvedValue({ ok: true })
    render(<InvoiceSettingsForm initial={{ gstRegistered: false, paymentDetails: "" }} />)
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.change(screen.getByLabelText("Payment details on invoices"), { target: { value: "BSB 000-000" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByRole("status")).toHaveTextContent("Saved")
    expect(updateInvoiceSettings).toHaveBeenCalledWith({ gstRegistered: true, paymentDetails: "BSB 000-000" })
  })
  it("shows an error", async () => {
    ;(updateInvoiceSettings as jest.Mock).mockResolvedValue({ error: "Unauthorized" })
    render(<InvoiceSettingsForm initial={{ gstRegistered: true, paymentDetails: "x" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized")
  })
})
