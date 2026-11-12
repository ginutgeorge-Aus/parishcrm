import { render, screen } from "@testing-library/react"
import GivingStatementsPage from "@/app/(dashboard)/accounting/giving-statements/page"
import FeatureLayout from "@/app/(dashboard)/accounting/giving-statements/layout"
import { auth } from "@/auth"
import { listGivingStatements, listStatementSendLog } from "@/lib/actions/givingStatement"
import { requireFeature } from "@/lib/featureFlags"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }),
  useRouter: jest.fn(), usePathname: jest.fn(), useSearchParams: jest.fn(),
}))
jest.mock("@/lib/actions/givingStatement", () => ({ listGivingStatements: jest.fn(), listStatementSendLog: jest.fn(), sendGivingStatements: jest.fn() }))
jest.mock("@/components/accounting/YearSelector", () => ({ YearSelector: () => <div data-testid="year" /> }))
jest.mock("@/components/accounting/GivingStatementsClient", () => ({
  GivingStatementsClient: ({ year, canManage }: { year: number; canManage: boolean }) => (
    <div data-testid="client">{year}:{String(canManage)}</div>
  ),
}))

const mockAuth = auth as jest.Mock
const rows = listGivingStatements as jest.Mock
const log = listStatementSendLog as jest.Mock

const renderPage = async (year?: string) => render(await GivingStatementsPage({ searchParams: Promise.resolve({ year }) }))

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  rows.mockResolvedValue([{ familyId: 1 }])
  log.mockResolvedValue([])
})

describe("GivingStatementsPage", () => {
  it("redirects roles without accounting view", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT")
  })

  it("renders the client keyed by the requested year", async () => {
    await renderPage("2024")
    expect(screen.getByTestId("client")).toHaveTextContent("2024:true")
    expect(screen.getByText(/no statements sent for this year yet/i)).toBeInTheDocument()
  })

  it("is read-only for an auditor", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    await renderPage("2024")
    expect(screen.getByTestId("client")).toHaveTextContent("2024:false")
  })

  it("shows an empty state when there is no giving", async () => {
    rows.mockResolvedValue([])
    await renderPage("2024")
    expect(screen.getByText(/no giving recorded for fy/i)).toBeInTheDocument()
  })

  it("shows operational errors in place instead of redirecting", async () => {
    rows.mockResolvedValue({ error: "Too many gifts in this financial year to build statements safely." })
    await renderPage("2024")
    expect(screen.getByRole("alert")).toHaveTextContent(/Too many gifts/)
    rows.mockResolvedValue([])
    log.mockResolvedValue({ error: "log broke" })
    await renderPage("2024")
    expect(screen.getAllByRole("alert")[1]).toHaveTextContent("log broke")
  })

  it("lists send log entries", async () => {
    log.mockResolvedValue([
      { id: 1, familyId: 1, familyName: "Smith", status: "SENT", at: new Date("2026-07-01T00:00:00Z"), sentBy: "Pat" },
      { id: 2, familyId: 2, familyName: "Jones", status: "FAILED", at: new Date("2026-07-02T00:00:00Z"), sentBy: "Pat" },
    ])
    await renderPage("2024")
    expect(screen.getByText("Smith")).toBeInTheDocument()
    expect(screen.getByText("FAILED")).toBeInTheDocument()
  })
})

describe("giving-statements layout", () => {
  it("requires the receipts feature and renders children", async () => {
    const out = await FeatureLayout({ children: <p>kid</p> })
    expect(requireFeature).toHaveBeenCalledWith("receipts")
    render(out)
    expect(screen.getByText("kid")).toBeInTheDocument()
  })
})
