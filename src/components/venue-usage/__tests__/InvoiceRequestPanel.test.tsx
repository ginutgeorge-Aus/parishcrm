/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { InvoiceRequestPanel } from "@/components/venue-usage/InvoiceRequestPanel"
import { getVenueRequestPreview, sendVenueUsageRequest } from "@/lib/actions/venueUsage"
import { approveVenueMonth, withdrawVenueApproval } from "@/lib/actions/venueBookings"

jest.mock("@/lib/actions/venueUsage", () => ({
  getVenueRequestPreview: jest.fn(),
  sendVenueUsageRequest: jest.fn(),
}))
jest.mock("@/lib/actions/venueBookings", () => ({
  approveVenueMonth: jest.fn(),
  withdrawVenueApproval: jest.fn(),
}))
jest.mock("next/navigation", () => ({ unstable_rethrow: jest.fn() }))

const preview = {
  month: "2026-10",
  subject: "Invoice request",
  text: "Hello Pat, please invoice October.",
  to: "venue@example.com",
  cc: "",
  replyTo: "office@example.com",
  rowCount: 3,
  totalHours: 9,
  blockedReason: null,
  last: null,
  isCurrentMonth: true,
  autoSendLabel: "1 November, 9:00 AM",
  approval: null,
  canApprove: true,
  warnings: [] as string[],
  autoSent: false,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue(preview)
})

it("shows warnings above the preview", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, canApprove: false, warnings: ["1 date is still marked Requested"] })
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  expect(await screen.findByText("1 date is still marked Requested")).toBeInTheDocument()
})
it("hides the automatic-send section for a month that is not the current one", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, isCurrentMonth: false })
  render(<InvoiceRequestPanel defaultMonth="2026-09" />)
  await screen.findByText(/confirmed bookings/i)
  expect(screen.queryByRole("button", { name: /approve automatic send/i })).not.toBeInTheDocument()
})
it("approve is disabled until the month is complete and explains why", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, canApprove: false, warnings: ["x"] })
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  expect(await screen.findByRole("button", { name: /approve automatic send on 1 november, 9:00 am/i })).toBeDisabled()
  expect(screen.getByText(/complete every sunday/i)).toBeInTheDocument()
})
it("approves after a confirm dialog that shows the email preview", async () => {
  ;(approveVenueMonth as jest.Mock).mockResolvedValue({ success: "Approved" })
  const user = userEvent.setup()
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  await user.click(await screen.findByRole("button", { name: /approve automatic send/i }))
  expect(await screen.findAllByText(/Hello Pat/)).not.toHaveLength(0)
  await user.click(screen.getByRole("button", { name: /^approve$/i }))
  await waitFor(() => expect(approveVenueMonth).toHaveBeenCalledWith("2026-10"))
})
it("shows who approved and lets the approval be withdrawn", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, approval: { approvedAt: "2026-10-24T01:00:00.000Z", approvedBy: "Sam Admin" } })
  ;(withdrawVenueApproval as jest.Mock).mockResolvedValue({ success: "Approval withdrawn" })
  const user = userEvent.setup()
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  expect(await screen.findByText(/approved by sam admin/i)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /withdraw approval/i }))
  await waitFor(() => expect(withdrawVenueApproval).toHaveBeenCalledWith("2026-10"))
})
it("still offers Send / Send again and passes the resend flag", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, last: { status: "SUCCESS", sentAt: "2026-10-01T00:00:00.000Z", errorMessage: null } })
  ;(sendVenueUsageRequest as jest.Mock).mockResolvedValue({ success: "Invoice request sent" })
  const user = userEvent.setup()
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  await user.click(await screen.findByRole("button", { name: /send again/i }))
  await user.click(await screen.findByRole("button", { name: /^send$/i }))
  await waitFor(() => expect(sendVenueUsageRequest).toHaveBeenCalledWith("2026-10", true))
})
it("says when the request went out automatically", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, autoSent: true, last: { status: "SUCCESS", sentAt: "2026-10-01T00:00:00.000Z", errorMessage: null } })
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  expect(await screen.findByText("Sent automatically.")).toBeInTheDocument()
})

/** Build a promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

it("hides the old preview while a new month loads, so no action can run on the wrong month", async () => {
  const next = deferred<typeof preview>()
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValueOnce(preview).mockReturnValueOnce(next.promise)
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  await screen.findByRole("button", { name: /send request/i })
  fireEvent.change(screen.getByLabelText(/month to invoice/i), { target: { value: "2026-09" } })
  expect(screen.queryByRole("button", { name: /send request/i })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /approve automatic send/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/Hello Pat/)).not.toBeInTheDocument()
  next.resolve({ ...preview, month: "2026-09", isCurrentMonth: false })
  expect(await screen.findByRole("button", { name: /send request/i })).toBeInTheDocument()
})
it("closes an open confirm dialog on a month change and sends nothing; the new month is then sent as shown", async () => {
  const next = deferred<typeof preview>()
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValueOnce(preview).mockReturnValueOnce(next.promise)
  ;(sendVenueUsageRequest as jest.Mock).mockResolvedValue({ success: "ok" })
  const user = userEvent.setup()
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  await user.click(await screen.findByRole("button", { name: /send request/i }))
  expect(await screen.findByRole("button", { name: /^send$/i })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/month to invoice/i), { target: { value: "2026-09" } })
  expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument()
  expect(sendVenueUsageRequest).not.toHaveBeenCalled()
  next.resolve({ ...preview, month: "2026-09", isCurrentMonth: false })
  await user.click(await screen.findByRole("button", { name: /send request/i }))
  await user.click(await screen.findByRole("button", { name: /^send$/i }))
  await waitFor(() => expect(sendVenueUsageRequest).toHaveBeenCalledWith("2026-09", false))
})
it("ignores a late response for a month that is no longer selected", async () => {
  const old = deferred<typeof preview>()
  const fresh = deferred<typeof preview>()
  ;(getVenueRequestPreview as jest.Mock).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  fireEvent.change(screen.getByLabelText(/month to invoice/i), { target: { value: "2026-09" } })
  fresh.resolve({ ...preview, month: "2026-09", subject: "September subject", isCurrentMonth: false })
  expect(await screen.findByText("September subject")).toBeInTheDocument()
  old.resolve({ ...preview, month: "2026-10", subject: "October subject" })
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.queryByText("October subject")).not.toBeInTheDocument()
  expect(screen.getByText("September subject")).toBeInTheDocument()
})
it("refetches the preview when dataVersion changes", async () => {
  const { rerender } = render(<InvoiceRequestPanel defaultMonth="2026-10" dataVersion={0} />)
  await screen.findByText(/confirmed bookings/i)
  const before = (getVenueRequestPreview as jest.Mock).mock.calls.length
  rerender(<InvoiceRequestPanel defaultMonth="2026-10" dataVersion={1} />)
  await waitFor(() => expect((getVenueRequestPreview as jest.Mock).mock.calls.length).toBeGreaterThan(before))
})
it("calls onApproved only after a successful approval", async () => {
  ;(approveVenueMonth as jest.Mock).mockResolvedValue({ success: "Approved" })
  const onApproved = jest.fn()
  const user = userEvent.setup()
  render(<InvoiceRequestPanel defaultMonth="2026-10" onApproved={onApproved} />)
  await user.click(await screen.findByRole("button", { name: /approve automatic send/i }))
  await user.click(await screen.findByRole("button", { name: /^approve$/i }))
  await waitFor(() => expect(onApproved).toHaveBeenCalledTimes(1))
})
it("does not call onApproved when approval fails", async () => {
  ;(approveVenueMonth as jest.Mock).mockResolvedValue({ error: "nope" })
  const onApproved = jest.fn()
  const user = userEvent.setup()
  render(<InvoiceRequestPanel defaultMonth="2026-10" onApproved={onApproved} />)
  await user.click(await screen.findByRole("button", { name: /approve automatic send/i }))
  await user.click(await screen.findByRole("button", { name: /^approve$/i }))
  await waitFor(() => expect(approveVenueMonth).toHaveBeenCalled())
  expect(onApproved).not.toHaveBeenCalled()
})

it("shows the last-request time on the Sydney wall clock", async () => {
  // 2026-10-01T23:30Z is 02/10/2026 09:30 in Sydney (AEST), whatever the test machine zone.
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, last: { status: "SUCCESS", sentAt: "2026-10-01T23:30:00.000Z", errorMessage: null } })
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  expect(await screen.findByText("02/10/2026 09:30")).toBeInTheDocument()
})
