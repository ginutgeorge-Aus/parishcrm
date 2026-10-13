import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import InvoiceForm from "@/components/accounting/InvoiceForm"
import { getRecipientContact } from "@/lib/actions/invoice"
import { createCustomerInline } from "@/lib/actions/customer"

jest.mock("@/lib/actions/invoice", () => ({ createInvoice: jest.fn(), updateInvoice: jest.fn(), getRecipientContact: jest.fn() }))
jest.mock("@/lib/actions/customer", () => ({ createCustomerInline: jest.fn() }))

const props = {
  recipients: [
    { kind: "customer" as const, id: 3, name: "Example Scouts" },
    { kind: "person" as const, id: 5, name: "Alex Example" },
  ],
  accounts: [{ id: 4, name: "4001 Hall hire" }], funds: [{ id: 2, name: "General" }], gstEnabled: true,
}

beforeEach(() => jest.clearAllMocks())

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: "Choose recipient" }))
}

describe("recipient picker in InvoiceForm", () => {
  it("picking a member fills name, email and address", async () => {
    ;(getRecipientContact as jest.Mock).mockResolvedValue({ email: "alex@example.com", address: "2 Example Rd" })
    render(<InvoiceForm {...props} />)
    openPicker()
    fireEvent.click(await screen.findByText("Alex Example"))
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("alex@example.com"))
    expect(screen.getByLabelText("Name")).toHaveValue("Alex Example")
    expect(screen.getByLabelText("Address")).toHaveValue("2 Example Rd")
    expect(getRecipientContact).toHaveBeenCalledWith("person", 5)
  })

  it("surfaces a contact lookup error", async () => {
    ;(getRecipientContact as jest.Mock).mockResolvedValue({ error: "Not found" })
    render(<InvoiceForm {...props} />)
    openPicker()
    fireEvent.click(await screen.findByText("Example Scouts"))
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this recipient's contact details")
    expect(screen.getByLabelText("Email")).toHaveValue("")
  })

  it("recovers when the lookup rejects (transport/server failure)", async () => {
    ;(getRecipientContact as jest.Mock).mockRejectedValue(new Error("network"))
    render(<InvoiceForm {...props} />)
    openPicker()
    fireEvent.click(await screen.findByText("Example Scouts"))
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this recipient's contact details")
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled()
  })

  it("clears the previous recipient's contact at once and blocks saving until the lookup lands", async () => {
    let resolve: (v: unknown) => void = () => {}
    ;(getRecipientContact as jest.Mock)
      .mockResolvedValueOnce({ email: "alex@example.com", address: "2 Example Rd" })
      .mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    render(<InvoiceForm {...props} />)
    openPicker()
    fireEvent.click(await screen.findByText("Alex Example"))
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("alex@example.com"))
    openPicker()
    fireEvent.click(await screen.findByText("Example Scouts"))
    expect(screen.getByLabelText("Email")).toHaveValue("")
    expect(screen.getByLabelText("Address")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled()
    resolve({ email: "scouts@example.com", address: "" })
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled())
    expect(screen.getByLabelText("Email")).toHaveValue("scouts@example.com")
  })

  it("creates a new customer inline and selects it", async () => {
    ;(createCustomerInline as jest.Mock).mockResolvedValue({ id: 9, name: "New Group" })
    ;(getRecipientContact as jest.Mock).mockResolvedValue({ email: "new@example.com", address: "" })
    render(<InvoiceForm {...props} />)
    openPicker()
    fireEvent.click(await screen.findByText("+ New customer"))
    fireEvent.change(screen.getByLabelText("New customer name"), { target: { value: "New Group" } })
    fireEvent.change(screen.getByLabelText("New customer email"), { target: { value: "new@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Save customer" }))
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("New Group"))
    expect(createCustomerInline).toHaveBeenCalledWith({ name: "New Group", email: "new@example.com", address: "" })
  })

  it("shows an inline-create error and can cancel", async () => {
    ;(createCustomerInline as jest.Mock).mockResolvedValue({ error: "Name is required" })
    render(<InvoiceForm {...props} />)
    openPicker()
    fireEvent.click(await screen.findByText("+ New customer"))
    fireEvent.click(screen.getByRole("button", { name: "Save customer" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Name is required")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByLabelText("New customer name")).not.toBeInTheDocument()
  })

  it("clears a picked recipient back to manual entry", async () => {
    ;(getRecipientContact as jest.Mock).mockResolvedValue({ email: "", address: "" })
    const { container } = render(<InvoiceForm {...props} />)
    openPicker()
    fireEvent.click(await screen.findByText("Example Scouts"))
    await waitFor(() => expect(container.querySelector('input[name="recipientKind"]')).toHaveValue("customer"))
    openPicker()
    fireEvent.click(await screen.findByText("Clear (type recipient manually)"))
    expect(container.querySelector('input[name="recipientKind"]')).toHaveValue("none")
  })

  it("prefills an existing draft", () => {
    const { container } = render(<InvoiceForm {...props} edit={{
      id: 11, invoiceNo: null, status: "DRAFT", personId: null, customerId: 3, recipientName: "Example Scouts",
      recipientEmail: "scouts@example.com", recipientAddress: "1 Example St", issueDate: "2026-10-11", dueDate: "2026-10-25",
      lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }], subtotal: "300.00", gstTotal: "30.00", total: "330.00",
      taxInvoice: false, accountId: 4, accountName: "Hall hire", fundId: 2, fundName: "General", notes: "Thanks",
      sentAt: null, paidAt: null, voidedAt: null, voidReason: null, paymentTransactionId: null, updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    }} />)
    expect(screen.getByLabelText("Line 1 unit price")).toHaveValue("150.00")
    expect(screen.getByTestId("invoice-total")).toHaveTextContent("$330.00")
    expect(container.querySelector('input[name="recipientId"]')).toHaveValue("3")
    expect(screen.getByLabelText("Notes (printed on the invoice)")).toHaveValue("Thanks")
    fireEvent.click(screen.getByLabelText("Line 1 GST"))
    expect(screen.getByTestId("invoice-gst")).toHaveTextContent("$0.00")
  })

  it("keeps stored per-line GST flags while GST is disabled", () => {
    const { container } = render(<InvoiceForm {...props} gstEnabled={false} edit={{
      id: 11, invoiceNo: null, status: "DRAFT", personId: null, customerId: null, recipientName: "X",
      recipientEmail: null, recipientAddress: null, issueDate: "2026-10-11", dueDate: "2026-10-25",
      lines: [{ description: "Hall hire", qty: 1, unitPriceCents: 10000, gst: true }], subtotal: "100.00", gstTotal: "0.00", total: "100.00",
      taxInvoice: false, accountId: 4, accountName: "Hall hire", fundId: null, fundName: null, notes: null,
      sentAt: null, paidAt: null, voidedAt: null, voidReason: null, paymentTransactionId: null, updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    }} />)
    const lines = JSON.parse((container.querySelector('input[name="lines"]') as HTMLInputElement).value)
    expect(lines[0].gst).toBe(true)
    expect(screen.getByTestId("invoice-total")).toHaveTextContent("$100.00")
  })
})

describe("InvoiceForm keeps input after a rejected save", () => {
  it("does not reset dates, account, fund or notes when the server returns an error", async () => {
    const { createInvoice } = jest.requireMock("@/lib/actions/invoice")
    ;(createInvoice as jest.Mock).mockResolvedValue({ error: "Due date must be on or after the issue date" })
    render(<InvoiceForm {...props} />)
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Example Scouts" } })
    fireEvent.change(screen.getByLabelText("Issue date"), { target: { value: "2026-10-20" } })
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-01" } })
    fireEvent.change(screen.getByLabelText("Income account"), { target: { value: "4" } })
    fireEvent.change(screen.getByLabelText("Fund (optional)"), { target: { value: "2" } })
    fireEvent.change(screen.getByLabelText("Notes (printed on the invoice)"), { target: { value: "Keep me" } })
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }))
    expect(await screen.findByText("Due date must be on or after the issue date")).toBeInTheDocument()
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-10-01")
    expect(screen.getByLabelText("Issue date")).toHaveValue("2026-10-20")
    expect(screen.getByLabelText("Income account")).toHaveValue("4")
    expect(screen.getByLabelText("Fund (optional)")).toHaveValue("2")
    expect(screen.getByLabelText("Notes (printed on the invoice)")).toHaveValue("Keep me")
  })

  it("disables inline customer save while it runs", async () => {
    let resolve: (v: unknown) => void = () => {}
    ;(createCustomerInline as jest.Mock).mockImplementation(() => new Promise((r) => { resolve = r }))
    render(<InvoiceForm {...props} />)
    openPicker()
    fireEvent.click(await screen.findByText("+ New customer"))
    fireEvent.change(screen.getByLabelText("New customer name"), { target: { value: "Dup Group" } })
    fireEvent.click(screen.getByRole("button", { name: "Save customer" }))
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }))
    expect(createCustomerInline).toHaveBeenCalledTimes(1)
    resolve({ id: 10, name: "Dup Group" })
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Dup Group"))
  })
})
