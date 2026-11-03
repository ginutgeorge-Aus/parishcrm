import { render, screen } from "@testing-library/react"
import NewTransferPage from "../page"

const findUnique = jest.fn()
const listCandidates = jest.fn()
const formProps = jest.fn()

jest.mock("@/lib/prisma", () => ({ prisma: { pettyCashSession: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))
jest.mock("@/lib/pettyCashPageGuard", () => ({ requirePettyCashSessionId: jest.fn(async () => 1) }))
jest.mock("@/lib/actions/pettyCashTransfer", () => ({ createTransfer: { bind: jest.fn(() => jest.fn()) } }))
jest.mock("@/lib/pettyCashLedger", () => ({ calcRunningBalance: jest.fn(() => 100) }))
jest.mock("@/lib/pettyCashTransferCandidates", () => ({
  listImportedTransferCandidates: (...a: unknown[]) => listCandidates(...a),
}))
jest.mock("@/components/petty-cash/TransferForm", () => ({
  TransferForm: (p: Record<string, unknown>) => {
    formProps(p)
    return <div data-testid="form" />
  },
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))

type SP = { date?: string | string[]; amount?: string | string[] }

/**
 * Renders the async page with the given search params.
 * @param sp Raw search params as Next would deliver them.
 */
async function renderPage(sp: SP) {
  const ui = await NewTransferPage({ params: Promise.resolve({ id: "1" }), searchParams: Promise.resolve(sp) })
  render(ui)
}

beforeEach(() => {
  jest.clearAllMocks()
  findUnique.mockResolvedValue({
    id: 1, title: "Session A", status: "OPEN", openingBalance: "100.00", receipts: [], expenses: [], transfers: [],
  })
  listCandidates.mockResolvedValue({ options: [], truncated: false })
})

test("no params: unfiltered lookup", async () => {
  await renderPage({})
  expect(listCandidates).toHaveBeenCalledWith(undefined)
  expect(formProps.mock.calls[0][0].importedFiltered).toBe(false)
  expect(screen.getByText("Session A")).toBeInTheDocument()
})

test("valid date + amount: focus passed through", async () => {
  await renderPage({ date: "2024-03-05", amount: "50.00" })
  expect(listCandidates).toHaveBeenCalledWith({ amount: "50.00", date: new Date("2024-03-05T00:00:00.000Z") })
  expect(formProps.mock.calls[0][0].importedFiltered).toBe(true)
})

test.each([
  ["impossible date", { date: "2024-02-31", amount: "50.00" }],
  ["malformed date", { date: "05/03/2024", amount: "50.00" }],
  ["bad amount", { date: "2024-03-05", amount: "abc" }],
  ["missing amount", { date: "2024-03-05" }],
  ["missing date", { amount: "50.00" }],
  ["repeated params", { date: ["2024-03-05", "2024-03-06"], amount: ["50.00", "1.00"] }],
])("%s: focus ignored", async (_name, sp) => {
  await renderPage(sp as SP)
  expect(listCandidates).toHaveBeenCalledWith(undefined)
  expect(formProps.mock.calls[0][0].importedFiltered).toBe(false)
})

test("passes a fresh submission token per page load (#491)", async () => {
  await renderPage({})
  await renderPage({})
  const [a, b] = formProps.mock.calls.map((c) => c[0].submissionToken)
  expect(a).toMatch(/^[0-9a-f-]{36}$/)
  expect(b).not.toBe(a)
})
