import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { SendReceiptsClient } from "@/components/accounting/SendReceiptsClient"
import { fetchTransactionsForReceipt, sendBatchReceipts } from "@/lib/actions/receipt"

jest.mock("@/lib/actions/receipt", () => ({
  fetchTransactionsForReceipt: jest.fn(),
  sendBatchReceipts: jest.fn(),
}))

const mockFetch = fetchTransactionsForReceipt as jest.Mock
const mockSend = sendBatchReceipts as jest.Mock

const accounts = [
  { id: 1, code: "4001", name: "Tithes" },
  { id: 2, code: "5001", name: "Donations" },
]

const makeRow = (id: number, email: string | null = "member@example.com") => ({
  id,
  date: new Date("2026-05-01"),
  description: `Transaction ${id}`,
  account: "Tithes",
  amount: 100,
  familyName: "Smith",
  personName: null,
  defaultEmail: email,
  lastSentAt: null,
})

// The component uses plain <label> text with no htmlFor — query date inputs by type/order
function getDateInputs() {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]')
  return { fromInput: inputs[0], toInput: inputs[1] }
}

async function loadTransactions(rows = [makeRow(1), makeRow(2)]) {
  mockFetch.mockResolvedValueOnce({ transactions: rows })
  const { fromInput, toInput } = getDateInputs()
  fireEvent.change(fromInput, { target: { value: "2026-05-01" } })
  fireEvent.change(toInput, { target: { value: "2026-05-31" } })
  fireEvent.click(screen.getByRole("button", { name: /load transactions/i }))
  await waitFor(() => {
    const table = screen.getByRole("table")
    expect(within(table).getByText("Transaction 1")).toBeInTheDocument()
  })
}

describe("SendReceiptsClient", () => {
  beforeEach(() => jest.clearAllMocks())

  describe("select-all toggle", () => {
    it("checks all rows when select-all is toggled on", async () => {
      render(<SendReceiptsClient accounts={accounts} />)
      await loadTransactions()

      const selectAll = screen.getByRole("checkbox", { name: /select all/i })
      fireEvent.click(selectAll)

      // Send button should reflect 2 selected
      expect(screen.getByRole("button", { name: /send 2 receipts/i })).toBeInTheDocument()
    })

    it("unchecks all rows when select-all is toggled off", async () => {
      render(<SendReceiptsClient accounts={accounts} />)
      await loadTransactions()

      const selectAll = screen.getByRole("checkbox", { name: /select all/i })
      // Select all first
      fireEvent.click(selectAll)
      expect(screen.getByRole("button", { name: /send 2 receipts/i })).toBeInTheDocument()

      // Deselect all
      fireEvent.click(selectAll)
      expect(screen.getByRole("button", { name: /send 0 receipts/i })).toBeInTheDocument()
    })
  })

  describe("amount cell", () => {
    it("uses the house .tabular utility", async () => {
      render(<SendReceiptsClient accounts={accounts} />)
      await loadTransactions()

      const table = screen.getByRole("table")
      const cell = within(table).getByText("Transaction 1").closest("tr")!.querySelector("td:nth-child(5)")
      expect(cell?.className).toMatch(/\btabular\b/)
    })
  })

  describe("batch send", () => {
    it("calls sendBatchReceipts with selected transaction ids and emails", async () => {
      mockSend.mockResolvedValueOnce({ sent: 2, failed: 0, errors: [] })
      render(<SendReceiptsClient accounts={accounts} />)
      await loadTransactions()

      // Select all
      fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }))
      fireEvent.click(screen.getByRole("button", { name: /send 2 receipts/i }))

      await waitFor(() =>
        expect(mockSend).toHaveBeenCalledWith([
          { transactionId: 1, toEmail: "member@example.com" },
          { transactionId: 2, toEmail: "member@example.com" },
        ])
      )
    })

    it("disables send button while sending is in-flight", async () => {
      let resolve!: (v: { sent: number; failed: number; errors: [] }) => void
      mockSend.mockReturnValue(new Promise((res) => { resolve = res }))

      render(<SendReceiptsClient accounts={accounts} />)
      await loadTransactions()

      fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }))
      const sendBtn = screen.getByRole("button", { name: /send 2 receipts/i })
      fireEvent.click(sendBtn)

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled()
      )

      // Resolve and wait for all state flushes to avoid act() warnings
      await waitFor(async () => {
        resolve({ sent: 2, failed: 0, errors: [] })
        await Promise.resolve()
      })
      await waitFor(() => expect(screen.getByText(/2 sent/i)).toBeInTheDocument())
    })

    it("shows success summary after all receipts sent", async () => {
      mockSend.mockResolvedValueOnce({ sent: 2, failed: 0, errors: [] })
      render(<SendReceiptsClient accounts={accounts} />)
      await loadTransactions()

      fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }))
      fireEvent.click(screen.getByRole("button", { name: /send 2 receipts/i }))

      await waitFor(() => expect(screen.getByText(/2 sent/i)).toBeInTheDocument())
      expect(screen.getByText(/0 failed/i)).toBeInTheDocument()
    })

    it("shows error message when sendBatchReceipts returns an error", async () => {
      mockSend.mockResolvedValueOnce({ error: "Email service unavailable" })
      render(<SendReceiptsClient accounts={accounts} />)
      await loadTransactions()

      fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }))
      fireEvent.click(screen.getByRole("button", { name: /send 2 receipts/i }))

      await waitFor(() =>
        expect(screen.getByText("Email service unavailable")).toBeInTheDocument()
      )
    })

    it("shows partial-failure summary with per-row error details", async () => {
      mockSend.mockResolvedValueOnce({
        sent: 1,
        failed: 1,
        errors: [{ transactionId: 2, error: "Invalid address" }],
      })
      render(<SendReceiptsClient accounts={accounts} />)
      await loadTransactions()

      fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }))
      fireEvent.click(screen.getByRole("button", { name: /send 2 receipts/i }))

      await waitFor(() => expect(screen.getByText(/1 sent/i)).toBeInTheDocument())
      expect(screen.getByText(/1 failed/i)).toBeInTheDocument()
      expect(screen.getByText(/Transaction #2.*Invalid address/i)).toBeInTheDocument()
    })
  })

  describe("fetch error", () => {
    it("shows fetch error when fetchTransactionsForReceipt returns an error", async () => {
      mockFetch.mockResolvedValueOnce({ error: "Database connection failed" })
      render(<SendReceiptsClient accounts={accounts} />)

      const { fromInput, toInput } = getDateInputs()
      fireEvent.change(fromInput, { target: { value: "2026-05-01" } })
      fireEvent.change(toInput, { target: { value: "2026-05-31" } })
      fireEvent.click(screen.getByRole("button", { name: /load transactions/i }))

      await waitFor(() =>
        expect(screen.getByText("Database connection failed")).toBeInTheDocument()
      )
    })
  })
})
