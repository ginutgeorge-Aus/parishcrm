/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react"
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
