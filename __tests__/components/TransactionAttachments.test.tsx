import { render, screen } from "@testing-library/react"
import { TransactionAttachments } from "@/components/accounting/TransactionAttachments"

// Server actions can't run in jsdom; stub the module so the client component
// renders. useActionState still returns its initial [state, action, pending].
jest.mock("@/lib/actions/transactionAttachment", () => ({
  attachTransactionReceipt: jest.fn(),
  removeTransactionReceipt: jest.fn(),
}))

const imageAtt = { id: 10, filename: "receipt.png", contentType: "image/png", size: 2048 }
const pdfAtt = { id: 11, filename: "invoice.pdf", contentType: "application/pdf", size: 1024 * 1024 }

it("shows an empty state when there are no attachments", () => {
  render(<TransactionAttachments transactionId={1} attachments={[]} canEdit={false} />)
  expect(screen.getByText(/no receipts attached yet/i)).toBeInTheDocument()
})

it("links each attachment to its scoped download route", () => {
  render(<TransactionAttachments transactionId={7} attachments={[imageAtt, pdfAtt]} canEdit={false} />)
  expect(screen.getByRole("link", { name: "receipt.png" })).toHaveAttribute(
    "href",
    "/api/accounting/transactions/7/attachments/10",
  )
  expect(screen.getByRole("link", { name: "invoice.pdf" })).toHaveAttribute(
    "href",
    "/api/accounting/transactions/7/attachments/11",
  )
})

it("renders an image thumbnail for image attachments", () => {
  render(<TransactionAttachments transactionId={7} attachments={[imageAtt]} canEdit={false} />)
  const img = screen.getByRole("img", { name: /receipt thumbnail: receipt\.png/i })
  expect(img).toHaveAttribute("src", "/api/accounting/transactions/7/attachments/10")
})

it("hides the upload form and Remove buttons for read-only roles", () => {
  render(<TransactionAttachments transactionId={7} attachments={[imageAtt]} canEdit={false} />)
  expect(screen.queryByRole("button", { name: /attach/i })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument()
})

it("shows the upload form and Remove control for editors", () => {
  render(<TransactionAttachments transactionId={7} attachments={[imageAtt]} canEdit={true} />)
  expect(screen.getByRole("button", { name: /attach/i })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument()
  expect(screen.getByLabelText(/attach a receipt image or pdf/i)).toBeInTheDocument()
})
