import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import CustomerForm from "@/components/accounting/CustomerForm"
import { CustomerActiveToggle } from "@/app/(dashboard)/accounting/customers/CustomerActiveToggle"
import { createCustomer, updateCustomer, setCustomerActive } from "@/lib/actions/customer"

const refresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
jest.mock("@/lib/actions/customer", () => ({ createCustomer: jest.fn(), updateCustomer: jest.fn(), setCustomerActive: jest.fn() }))

beforeEach(() => jest.clearAllMocks())

describe("CustomerForm", () => {
  it("renders empty for a new customer and shows server errors", async () => {
    ;(createCustomer as jest.Mock).mockResolvedValue({ error: "Enter a valid email" })
    render(<CustomerForm />)
    expect(screen.getByLabelText("Name")).toHaveValue("")
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Example Scouts" } })
    fireEvent.click(screen.getByRole("button", { name: "Save customer" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email")
    // Rejected save keeps what the user typed.
    expect(screen.getByLabelText("Name")).toHaveValue("Example Scouts")
  })
  it("prefills an existing customer and saves through updateCustomer", async () => {
    ;(updateCustomer as jest.Mock).mockResolvedValue(undefined)
    render(<CustomerForm edit={{ id: 9, name: "Example Scouts", abn: null, email: "scouts@example.com", phone: null, address: "1 Example St", notes: null, isActive: true }} />)
    expect(screen.getByLabelText("Name")).toHaveValue("Example Scouts")
    expect(screen.getByLabelText("Address")).toHaveValue("1 Example St")
    fireEvent.click(screen.getByRole("button", { name: "Save customer" }))
    await waitFor(() => expect(updateCustomer).toHaveBeenCalled())
    expect((updateCustomer as jest.Mock).mock.calls[0][0]).toBe(9)
  })
})

describe("CustomerActiveToggle", () => {
  it("deactivates and refreshes", async () => {
    ;(setCustomerActive as jest.Mock).mockResolvedValue({ success: "Customer deactivated" })
    render(<CustomerActiveToggle id={9} isActive />)
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(setCustomerActive).toHaveBeenCalledWith(9, false)
  })
  it("alerts on error", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {})
    ;(setCustomerActive as jest.Mock).mockResolvedValue({ error: "Customer not found" })
    render(<CustomerActiveToggle id={9} isActive={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Customer not found"))
    alertSpy.mockRestore()
  })
})
