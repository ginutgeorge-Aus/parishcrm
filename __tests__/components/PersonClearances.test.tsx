import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PersonClearances } from "@/components/people/PersonClearances"
import { verifyClearance, upsertClearance } from "@/lib/actions/clearance"

jest.mock("@/lib/actions/clearance", () => ({
  upsertClearance: jest.fn().mockResolvedValue(undefined),
  verifyClearance: jest.fn().mockResolvedValue(undefined),
  unverifyClearance: jest.fn().mockResolvedValue(undefined),
  deleteClearance: jest.fn().mockResolvedValue(undefined),
}))

const PORTAL = "https://wwccemployer.ocg.nsw.gov.au/Login"
const managerRows = [
  {
    type: "WWCC" as const,
    status: "UNVERIFIED" as const,
    clearanceId: "ckw",
    number: "WWC0000000E",
    expiresYmd: "2029-03-15",
    expiresLabel: "15/03/2029",
    hasDocument: true,
    documentName: "wwcc.pdf",
    verifiedLabel: null,
    verifiedByName: null,
    verificationNote: null,
  },
  {
    type: "SAFE_MINISTRY" as const,
    status: "UNVERIFIED" as const,
    clearanceId: "cks",
    number: null,
    expiresYmd: null,
    expiresLabel: null,
    hasDocument: false,
    documentName: null,
    verifiedLabel: null,
    verifiedByName: null,
    verificationNote: null,
  },
]
const manager = { personId: 3, canManage: true, wwccVerifyUrl: PORTAL, rows: managerRows }

beforeEach(() => jest.clearAllMocks())

it("VIEWER sees status badges only: no number, no buttons, no document link", () => {
  render(
    <PersonClearances
      personId={3}
      canManage={false}
      wwccVerifyUrl={null}
      rows={[{ type: "WWCC", status: "VERIFIED" }, { type: "SAFE_MINISTRY", status: "MISSING" }]}
    />,
  )
  expect(screen.getByText("Verified")).toBeInTheDocument()
  expect(screen.getByText("Missing")).toBeInTheDocument()
  expect(screen.queryByRole("button")).toBeNull()
  expect(screen.queryByRole("link")).toBeNull()
})

it("manager sees the number, expiry, and a link to the scoped document route", () => {
  render(<PersonClearances {...manager} />)
  const row = within(screen.getByTestId("clearance-WWCC"))
  expect(row.getByText("WWC0000000E")).toBeInTheDocument()
  expect(row.getByText(/15\/03\/2029/)).toBeInTheDocument()
  expect(row.getByRole("link", { name: /view document/i })).toHaveAttribute("href", "/api/people/3/clearances/ckw")
})

it("WWCC Verify opens a confirmation with the OCG portal link and calls verifyClearance with the note", async () => {
  const user = userEvent.setup()
  render(<PersonClearances {...manager} />)
  await user.click(within(screen.getByTestId("clearance-WWCC")).getByRole("button", { name: /^verify$/i }))
  const dialog = await screen.findByRole("dialog")
  const link = within(dialog).getByRole("link", { name: /check on ocg portal/i })
  expect(link).toHaveAttribute("href", PORTAL)
  expect(link).toHaveAttribute("target", "_blank")
  expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
  await user.type(within(dialog).getByLabelText(/note/i), "Checked on portal")
  await user.click(within(dialog).getByRole("button", { name: /confirm/i }))
  await waitFor(() => expect(verifyClearance).toHaveBeenCalledWith("ckw", "Checked on portal"))
})

it("Safe Ministry Verify has NO portal link", async () => {
  const user = userEvent.setup()
  const rows = [managerRows[0], { ...managerRows[1], number: "SM-1", expiresYmd: "2028-01-01", expiresLabel: "01/01/2028" }]
  render(<PersonClearances {...manager} rows={rows} />)
  await user.click(within(screen.getByTestId("clearance-SAFE_MINISTRY")).getByRole("button", { name: /^verify$/i }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).queryByRole("link", { name: /ocg portal/i })).toBeNull()
})

it("no Verify button when a clearance does not exist yet or is already verified", () => {
  const rows = [
    { ...managerRows[0], status: "VERIFIED" as const, verifiedLabel: "Tue 6 Oct 2026", verifiedByName: "Test Admin" },
    { type: "SAFE_MINISTRY" as const, status: "MISSING" as const },
  ]
  render(<PersonClearances {...manager} rows={rows} />)
  expect(screen.queryByRole("button", { name: /^verify$/i })).toBeNull()
  expect(screen.getByText(/Test Admin/)).toBeInTheDocument()
  expect(within(screen.getByTestId("clearance-WWCC")).getByRole("button", { name: /unverify/i })).toBeInTheDocument()
})

it("submitting the add form calls upsertClearance(personId, type, FormData)", async () => {
  const user = userEvent.setup()
  render(<PersonClearances {...manager} rows={[{ type: "WWCC", status: "MISSING" }, managerRows[1]]} />)
  const row = within(screen.getByTestId("clearance-WWCC"))
  await user.click(row.getByRole("button", { name: /^add$/i }))
  await user.type(row.getByLabelText(/number/i), "WWC0000000E")
  await user.click(row.getByRole("button", { name: /^save$/i }))
  await waitFor(() => expect(upsertClearance).toHaveBeenCalledWith(3, "WWCC", expect.any(FormData)))
})
