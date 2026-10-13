import { render, screen, fireEvent } from "@testing-library/react"
import InvoiceForm from "@/components/accounting/InvoiceForm"

jest.mock("@/lib/actions/invoice", () => ({ createInvoice: jest.fn(), updateInvoice: jest.fn(), getRecipientContact: jest.fn() }))
jest.mock("@/lib/actions/customer", () => ({ createCustomerInline: jest.fn() }))
jest.mock("@/components/accounting/RecipientPicker", () => ({
  RecipientPicker: ({ onPick }: { onPick: (o: null) => void }) => <button type="button" onClick={() => onPick(null)}>Clear recipient</button>,
}))

const props = {
  recipients: [{ kind: "customer" as const, id: 3, name: "Example Scouts" }],
  accounts: [{ id: 4, name: "Hall hire" }], funds: [], gstEnabled: true,
}

describe("InvoiceForm", () => {
  it("shows live totals with GST", () => {
    render(<InvoiceForm {...props} />)
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Hall hire" } })
    fireEvent.change(screen.getByLabelText("Line 1 quantity"), { target: { value: "2" } })
    fireEvent.change(screen.getByLabelText("Line 1 unit price"), { target: { value: "150" } })
    expect(screen.getByTestId("invoice-subtotal")).toHaveTextContent("$300.00")
    expect(screen.getByTestId("invoice-gst")).toHaveTextContent("$30.00")
    expect(screen.getByTestId("invoice-total")).toHaveTextContent("$330.00")
  })
  it("hides GST controls when not registered", () => {
    render(<InvoiceForm {...props} gstEnabled={false} />)
    expect(screen.queryByLabelText("Line 1 GST")).not.toBeInTheDocument()
    expect(screen.queryByTestId("invoice-gst")).not.toBeInTheDocument()
  })
  it("adds and removes lines", () => {
    render(<InvoiceForm {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Add line" }))
    expect(screen.getByLabelText("Line 2 description")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remove line 2" }))
    expect(screen.queryByLabelText("Line 2 description")).not.toBeInTheDocument()
  })
  it("clears the previous recipient's contact when switching to a manual recipient", () => {
    const edit = {
      id: 1, customerId: 3, personId: null, recipientName: "Example Scouts",
      recipientEmail: "scouts@example.com", recipientAddress: "1 Example St",
      issueDate: "2026-10-01", dueDate: "2026-10-15", accountId: 4, fundId: null, notes: "", lines: [],
    } as unknown as React.ComponentProps<typeof InvoiceForm>["edit"]
    render(<InvoiceForm {...props} edit={edit} />)
    expect(screen.getByLabelText("Email")).toHaveValue("scouts@example.com")
    fireEvent.click(screen.getByRole("button", { name: "Clear recipient" }))
    expect(screen.getByLabelText("Email")).toHaveValue("")
    expect(screen.getByLabelText("Address")).toHaveValue("")
  })
})
