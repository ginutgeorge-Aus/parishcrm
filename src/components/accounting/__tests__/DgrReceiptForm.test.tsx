import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import DgrReceiptForm from "@/components/accounting/DgrReceiptForm"
import { getDonorEmail } from "@/lib/actions/dgrReceipt"

jest.mock("@/lib/actions/dgrReceipt", () => ({
  createDgrReceipt: jest.fn(),
  updateDgrReceipt: jest.fn(),
  getDonorEmail: jest.fn(),
}))

const persons = [
  { id: 7, name: "Alex Admin" },
  { id: 8, name: "Anna Taylor" },
]

describe("DgrReceiptForm", () => {
  it("selecting a person fills personId and prefills the email on demand", async () => {
    ;(getDonorEmail as jest.Mock).mockResolvedValue({ email: "g@x.com" })
    const user = userEvent.setup()
    const { container } = render(<DgrReceiptForm persons={persons} currentFyEndYear={2026} />)

    await user.click(screen.getByText(/search donor/i))
    await user.click(screen.getByText("Alex Admin"))

    expect(container.querySelector('input[name="personId"]')).toHaveValue("7")
    expect(getDonorEmail).toHaveBeenCalledWith(7)
    await waitFor(() => expect(screen.getByLabelText(/donor email/i)).toHaveValue("g@x.com"))
  })

  it("running total and serialized lines reflect entered rows", async () => {
    const user = userEvent.setup()
    const { container } = render(<DgrReceiptForm persons={persons} currentFyEndYear={2026} />)

    fireEvent.change(screen.getByLabelText("Date for line 1"), { target: { value: "2024-07-24" } })
    await user.type(screen.getByLabelText("Amount for line 1"), "100")
    expect(screen.getByTestId("dgr-total")).toHaveTextContent("$100.00")

    await user.click(screen.getByRole("button", { name: /add line/i }))
    fireEvent.change(screen.getByLabelText("Date for line 2"), { target: { value: "2024-08-01" } })
    await user.type(screen.getByLabelText("Amount for line 2"), "50.50")
    expect(screen.getByTestId("dgr-total")).toHaveTextContent("$150.50")

    const linesInput = container.querySelector('input[name="lines"]') as HTMLInputElement
    expect(JSON.parse(linesInput.value)).toEqual([
      { date: "2024-07-24", amount: 100, method: "Bank Transfer" },
      { date: "2024-08-01", amount: 50.5, method: "Bank Transfer" },
    ])
  })

  it("edit mode prefills the receipt, fixes the FY, and shows a Save button", () => {
    const { container } = render(
      <DgrReceiptForm
        persons={persons}
        currentFyEndYear={2026}
        edit={{
          id: 42,
          personId: "7",
          email: "g@x.com",
          fyEndYear: 2025,
          lines: [{ date: "2024-07-24", amount: "100", method: "Cash" }],
        }}
      />
    )

    expect(container.querySelector('input[name="personId"]')).toHaveValue("7")
    expect(screen.getByLabelText(/donor email/i)).toHaveValue("g@x.com")
    expect(screen.getByLabelText("Amount for line 1")).toHaveValue(100)
    expect(screen.getByTestId("dgr-total")).toHaveTextContent("$100.00")
    // FY is fixed: read-only text + hidden field, no editable select.
    expect(container.querySelector('select[name="fyEndYear"]')).toBeNull()
    expect(container.querySelector('input[name="fyEndYear"]')).toHaveValue("2025")
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument()
  })

  it("ignores a stale donor-email lookup when a newer donor is picked", async () => {
    // Donor A (id 7) resolves LATER than donor B (id 8) — the stale A result must
    // not overwrite B's already-loaded email onto B's receipt.
    ;(getDonorEmail as jest.Mock).mockImplementation((id: number) =>
      id === 7
        ? new Promise((r) => setTimeout(() => r({ email: "a@x.com" }), 80))
        : new Promise((r) => setTimeout(() => r({ email: "b@x.com" }), 10))
    )
    const user = userEvent.setup()
    render(<DgrReceiptForm persons={persons} currentFyEndYear={2026} />)

    await user.click(screen.getByText(/search donor/i))
    await user.click(screen.getByText("Alex Admin")) // A (id 7)
    await user.click(screen.getByText("Alex Admin")) // reopen donor combobox (now shows A)
    await user.click(screen.getByText("Anna Taylor")) // B (id 8)

    await waitFor(() => expect(screen.getByLabelText(/donor email/i)).toHaveValue("b@x.com"))
    await new Promise((r) => setTimeout(r, 120)) // let A's stale lookup resolve
    expect(screen.getByLabelText(/donor email/i)).toHaveValue("b@x.com")
  })

  it("surfaces an error when the donor-email lookup rejects", async () => {
    ;(getDonorEmail as jest.Mock).mockRejectedValue(new Error("network"))
    const user = userEvent.setup()
    render(<DgrReceiptForm persons={persons} currentFyEndYear={2026} />)

    await user.click(screen.getByText(/search donor/i))
    await user.click(screen.getByText("Alex Admin"))

    expect(await screen.findByText(/could not load this donor's email/i)).toBeInTheDocument()
  })
})
