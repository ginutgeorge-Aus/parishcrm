import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const refresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
jest.mock("@/lib/actions/clearance", () => ({ verifyClearancesBulk: jest.fn() }))

import { verifyClearancesBulk } from "@/lib/actions/clearance"
import { WwccBatchVerify } from "@/components/people/WwccBatchVerify"
import { BULK_VERIFY_MAX, type WwccBatchRow } from "@/lib/clearanceComplianceView"

const mockVerify = verifyClearancesBulk as jest.Mock
const writeText = jest.fn().mockResolvedValue(undefined)

const row = (over: Partial<WwccBatchRow> = {}): WwccBatchRow => ({
  clearanceId: "c1", personId: 10, familyName: "Testperson", givenName: "Alex",
  dobDmy: "05/03/1990", number: "WWC0000000E", status: "UNVERIFIED",
  expiresDmy: "01/06/2027", updatedAt: "2026-10-01T00:00:00.000Z", ...over,
})
const rows = [
  row(),
  row({ clearanceId: "c2", personId: 11, familyName: "Sample", givenName: "Bo", dobDmy: null }),
  row({ clearanceId: "c3", personId: 12, familyName: "Other", givenName: "Cy", status: "EXPIRING" }),
]

beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
})

it("links to the portal in a new tab", () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://portal.example.test/login" />)
  const link = screen.getByRole("link", { name: /open ocg portal/i })
  expect(link).toHaveAttribute("href", "https://portal.example.test/login")
  expect(link).toHaveAttribute("target", "_blank")
  expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
})

it("shows columns in the portal field order and flags a row missing its DOB", () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent)
  expect(headers.indexOf("Family name")).toBeLessThan(headers.indexOf("Date of birth"))
  expect(headers.indexOf("Date of birth")).toBeLessThan(headers.indexOf("WWC number"))
  expect(screen.getByText("Missing date of birth")).toBeInTheDocument()
  expect(screen.getByRole("checkbox", { name: /select bo sample/i })).toBeDisabled()
  expect(screen.getByRole("checkbox", { name: /select alex testperson/i })).toBeEnabled()
})

it("copies a single cell", async () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("button", { name: "Copy WWC number for Alex Testperson" }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("WWC0000000E"))
})

it("copy all rows copies only ready rows, tab separated, in portal order", async () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("button", { name: /copy all rows/i }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(
    "Testperson\t05/03/1990\tWWC0000000E\nOther\t05/03/1990\tWWC0000000E"
  ))
})

it("Mark verified is disabled until a row is ticked, then sends id/updatedAt items and the note and refreshes", async () => {
  mockVerify.mockResolvedValue({ success: "Marked 2 clearance(s) verified" })
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  const mark = screen.getByRole("button", { name: /mark verified/i })
  expect(mark).toBeDisabled()
  fireEvent.click(screen.getByRole("checkbox", { name: /select alex testperson/i }))
  fireEvent.click(screen.getByRole("checkbox", { name: /select cy other/i }))
  fireEvent.change(screen.getByLabelText(/portal outcome note/i), { target: { value: "OCG: current" } })
  fireEvent.click(mark)
  await waitFor(() => expect(mockVerify).toHaveBeenCalledWith(
    [
      { id: "c1", seenUpdatedAt: "2026-10-01T00:00:00.000Z" },
      { id: "c3", seenUpdatedAt: "2026-10-01T00:00:00.000Z" },
    ],
    "OCG: current",
  ))
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Marked 2 clearance(s) verified"))
  expect(refresh).toHaveBeenCalled()
})

it("select all ticks only ready rows", () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("checkbox", { name: /select all ready/i }))
  expect(screen.getByRole("checkbox", { name: /select alex testperson/i })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: /select bo sample/i })).not.toBeChecked()
})

it("select all stops at the bulk limit so the server never rejects the batch", async () => {
  mockVerify.mockResolvedValue({ success: "ok" })
  const many = Array.from({ length: BULK_VERIFY_MAX + 5 }, (_, i) => row({ clearanceId: `m${i}`, personId: 100 + i, givenName: `G${i}` }))
  render(<WwccBatchVerify rows={many} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("checkbox", { name: /select the first 200 ready rows/i }))
  fireEvent.click(screen.getByRole("button", { name: /mark verified \(200\)/i }))
  await waitFor(() => expect(mockVerify).toHaveBeenCalled())
  expect(mockVerify.mock.calls[0][0]).toHaveLength(BULK_VERIFY_MAX)
})

it("shows an action error and does not refresh", async () => {
  mockVerify.mockResolvedValue({ error: "Unauthorized" })
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("checkbox", { name: /select alex testperson/i }))
  fireEvent.click(screen.getByRole("button", { name: /mark verified/i }))
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unauthorized"))
  expect(refresh).not.toHaveBeenCalled()
})

it("shows a stale-row error from the action", async () => {
  mockVerify.mockResolvedValue({ error: "This clearance changed. Refresh and try again." })
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("checkbox", { name: /select alex testperson/i }))
  fireEvent.click(screen.getByRole("button", { name: /mark verified/i }))
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This clearance changed"))
})

it("shows an empty state when nothing needs verifying", () => {
  render(<WwccBatchVerify rows={[]} verifyUrl="https://p.test" />)
  expect(screen.getByText(/no unverified wwccs to check/i)).toBeInTheDocument()
  expect(screen.queryByText(/no expiring/i)).not.toBeInTheDocument()
})
