import { render, screen, fireEvent } from "@testing-library/react"
import InvoiceForm from "@/components/accounting/InvoiceForm"

jest.mock("@/lib/actions/invoice", () => ({ createInvoice: jest.fn(), updateInvoice: jest.fn(), getRecipientContact: jest.fn() }))
jest.mock("@/lib/actions/customer", () => ({ createCustomerInline: jest.fn() }))

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
})
