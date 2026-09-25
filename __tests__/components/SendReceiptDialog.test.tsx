import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SendReceiptDialog } from "@/components/accounting/SendReceiptDialog"
import { sendSingleReceipt } from "@/lib/actions/receipt"

jest.mock("@/lib/actions/receipt", () => ({
  sendSingleReceipt: jest.fn(),
}))

const mockSend = sendSingleReceipt as jest.Mock

describe("SendReceiptDialog", () => {
  beforeEach(() => jest.clearAllMocks())

  it("disables Send button while action is in-flight to prevent duplicate sends", async () => {
    let resolve!: (v: { success: string }) => void
    mockSend.mockReturnValue(new Promise((res) => { resolve = res }))

    render(<SendReceiptDialog transactionId={1} defaultEmail="test@example.com" />)
    fireEvent.click(screen.getByRole("button", { name: /send receipt/i }))

    const sendButton = screen.getByRole("button", { name: /^send$/i })
    expect(sendButton).not.toBeDisabled()

    fireEvent.click(sendButton)
    await waitFor(() => expect(sendButton).toBeDisabled())

    resolve({ success: "Receipt sent to test@example.com" })
  })

  it("calls sendSingleReceipt only once when Send is clicked twice rapidly", async () => {
    let resolve!: (v: { success: string }) => void
    mockSend.mockReturnValue(new Promise((res) => { resolve = res }))

    render(<SendReceiptDialog transactionId={2} defaultEmail="test@example.com" />)
    fireEvent.click(screen.getByRole("button", { name: /send receipt/i }))

    const sendButton = screen.getByRole("button", { name: /^send$/i })
    fireEvent.click(sendButton)

    await waitFor(() => expect(sendButton).toBeDisabled())
    fireEvent.click(sendButton) // second click on disabled button

    expect(mockSend).toHaveBeenCalledTimes(1)
    resolve({ success: "sent" })
  })
})
