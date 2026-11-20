import { render, screen } from "@testing-library/react"
import EditTransferPage from "../page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { pettyCashTransfer: { findUnique: jest.fn() } } }))
jest.mock("@/lib/actions/pettyCashTransfer", () => ({ updateTransfer: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: (v: string) => v.replace(/^enc:/, "") }))
jest.mock("@/components/petty-cash/TransferForm", () => ({
  TransferForm: ({ transfer, maxAmount }: { transfer: { date: string; amount: string; notes: string }; maxAmount: number }) => (
    <div data-testid="form">{`${transfer.date}|${transfer.amount}|${transfer.notes}|${maxAmount}`}</div>
  ),
}))

const mockAuth = auth as jest.Mock
const mockFind = prisma.pettyCashTransfer.findUnique as jest.Mock

function row(over: Record<string, unknown> = {}, status = "OPEN") {
  return {
    id: 5,
    sessionId: 1,
    amount: "40.00",
    date: new Date("2026-07-31T00:00:00.000Z"),
    notes: "enc:hello",
    transaction: { bankRef: "PC_T_5" },
    session: {
      id: 1, title: "Sunday", status, openingBalance: "100.00",
      receipts: [], expenses: [], transfers: [{ amount: "40.00" }],
    },
    ...over,
  }
}

function run(params = { id: "1", transferId: "5" }) {
  return EditTransferPage({ params: Promise.resolve(params) })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mockFind.mockResolvedValue(row())
})

it("redirects roles without accounting access", async () => {
  mockAuth.mockResolvedValue({ user: { id: "2", role: "VIEWER" } })
  await expect(run()).rejects.toThrow("REDIRECT:/accounting/petty-cash")
})

it.each([{ id: "x", transferId: "5" }, { id: "1", transferId: "0" }])("404s on a bad route id %j", async (p) => {
  await expect(run(p)).rejects.toThrow("NOT_FOUND")
})

it("404s when the transfer is missing or belongs to another session", async () => {
  mockFind.mockResolvedValue(row({ sessionId: 2 }))
  await expect(run()).rejects.toThrow("NOT_FOUND")
  mockFind.mockResolvedValue(null)
  await expect(run()).rejects.toThrow("NOT_FOUND")
})

it("redirects to the session when it is closed", async () => {
  mockFind.mockResolvedValue(row({}, "CLOSED"))
  await expect(run()).rejects.toThrow("REDIRECT:/accounting/petty-cash/sessions/1")
})

it("renders the form with the loaded values and cash available (balance 60 + own 40)", async () => {
  render(await run())
  expect(screen.getByTestId("form")).toHaveTextContent("2026-07-31|40.00|hello|100")
})

it("shows a read-only notice for an adopted transfer instead of the form", async () => {
  mockFind.mockResolvedValue(row({ transaction: { bankRef: "XFER_OUT_ANZ_1" } }))
  render(await run())
  expect(screen.queryByTestId("form")).not.toBeInTheDocument()
  expect(screen.getByText(/cannot be edited here/)).toBeInTheDocument()
})
