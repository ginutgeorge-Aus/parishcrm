import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { DgrReceiptRowActions } from "@/components/accounting/DgrReceiptRowActions"
import { sendDgrReceipt } from "@/lib/actions/dgrReceipt"

jest.mock("@/lib/actions/dgrReceipt", () => ({ sendDgrReceipt: jest.fn(), deleteDgrReceipt: jest.fn() }))

const props = { id: 5, receiptNo: "DGR-2026-001", donorName: "Jane Donor", donorEmail: "jane@example.com", canManage: true }

beforeEach(() => jest.clearAllMocks())

it("does not send on the first click; confirm names receipt, donor, email and the freeze", async () => {
  ;(sendDgrReceipt as jest.Mock).mockResolvedValue({ success: "Sent" })
  render(<DgrReceiptRowActions {...props} status="DRAFT" />)
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  const dialog = await screen.findByRole("alertdialog")
  expect(dialog).toHaveTextContent("DGR-2026-001")
  expect(dialog).toHaveTextContent("Jane Donor")
  expect(dialog).toHaveTextContent("jane@example.com")
  expect(dialog).toHaveTextContent("can no longer be edited or deleted")
  expect(sendDgrReceipt).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }))
  await waitFor(() => expect(sendDgrReceipt).toHaveBeenCalledWith(5))
})

it("labels the action Resend for a SENT receipt and keeps the dialog open on error", async () => {
  ;(sendDgrReceipt as jest.Mock).mockResolvedValue({ error: "SMTP down" })
  render(<DgrReceiptRowActions {...props} status="SENT" />)
  fireEvent.click(screen.getByRole("button", { name: "Resend" }))
  const dialog = await screen.findByRole("alertdialog")
  fireEvent.click(within(dialog).getByRole("button", { name: "Resend" }))
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("SMTP down")
})
