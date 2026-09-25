/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ImportClient } from "@/components/petty-cash/ImportClient"
import { previewImport, commitImport } from "@/lib/actions/pettyCashImport"

jest.mock("@/lib/actions/pettyCashImport", () => ({
  previewImport: jest.fn(),
  commitImport: jest.fn(),
}))

// Render the shadcn Select as a plain native <select> — the rest of the
// codebase avoids driving Radix in jsdom, and this test is about ImportClient's
// own state machine (preview/commit gating), not Radix internals.
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select aria-label="Custodian" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Select custodian…</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

const mockedPreview = previewImport as jest.MockedFunction<typeof previewImport>
const mockedCommit = commitImport as jest.MockedFunction<typeof commitImport>

const custodians = [{ id: 1, name: "Alice" }]

const CSV = "date,type,amount\n2026-01-01,IN,10"
function makeFile() {
  const f = new File([CSV], "petty.csv", { type: "text/csv" })
  // jsdom's File has no .text() — the component calls it in onFile.
  Object.defineProperty(f, "text", { value: () => Promise.resolve(CSV) })
  return f
}

// Minimal ImportPreview — only the fields the component reads.
function makePreview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    rows: [
      {
        rowNumber: 1,
        rawDate: "2026-01-01",
        type: "Receipt",
        accountName: "Donations",
        payeeOrDonor: "Bob",
        amount: 10,
        errors: [],
        donor: { status: "matched", label: "Bob" },
      },
    ],
    sessions: ["01-JAN-2026"],
    receiptTotal: 10,
    expenseTotal: 0,
    hardErrorCount: 0,
    ...overrides,
  } as never
}

async function setCsvAndCustodian(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("CSV file"), makeFile())
  await user.selectOptions(screen.getByLabelText("Custodian"), "1")
}

beforeEach(() => jest.clearAllMocks())

describe("petty-cash ImportClient", () => {
  it("disables Preview until both CSV and custodian are set", async () => {
    const user = userEvent.setup()
    render(<ImportClient custodians={custodians} />)

    const preview = screen.getByRole("button", { name: "Preview" })
    expect(preview).toBeDisabled()

    await user.upload(screen.getByLabelText("CSV file"), makeFile())
    await waitFor(() => expect(preview).toBeDisabled()) // csv set, custodian still empty

    await user.selectOptions(screen.getByLabelText("Custodian"), "1")
    await waitFor(() => expect(preview).toBeEnabled())
  })

  it("renders an error message when preview fails", async () => {
    mockedPreview.mockResolvedValue({ error: "Bad CSV header" })
    const user = userEvent.setup()
    render(<ImportClient custodians={custodians} />)

    await setCsvAndCustodian(user)
    await user.click(screen.getByRole("button", { name: "Preview" }))

    expect(await screen.findByText("Bad CSV header")).toBeInTheDocument()
  })

  it("disables Commit when the preview has hard errors", async () => {
    mockedPreview.mockResolvedValue({ preview: makePreview({ hardErrorCount: 1 }) })
    const user = userEvent.setup()
    render(<ImportClient custodians={custodians} />)

    await setCsvAndCustodian(user)
    await user.click(screen.getByRole("button", { name: "Preview" }))

    const commit = await screen.findByRole("button", { name: "Commit import" })
    expect(commit).toBeDisabled()
  })

  it("invalidates the preview when the custodian changes", async () => {
    // A preview computed for custodian A must not survive a switch to custodian B,
    // or Commit would post reviewed rows under the wrong custodian's session.
    mockedPreview.mockResolvedValue({ preview: makePreview() })
    const user = userEvent.setup()
    render(<ImportClient custodians={[{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]} />)

    await user.upload(screen.getByLabelText("CSV file"), makeFile())
    await user.selectOptions(screen.getByLabelText("Custodian"), "1")
    await user.click(screen.getByRole("button", { name: "Preview" }))
    expect(await screen.findByRole("button", { name: "Commit import" })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText("Custodian"), "2")
    // Preview cleared -> Commit is gone, forcing a fresh preview for custodian B.
    expect(screen.queryByRole("button", { name: "Commit import" })).not.toBeInTheDocument()
  })

  it("clears the CSV and preview on a successful commit", async () => {
    mockedPreview.mockResolvedValue({ preview: makePreview() })
    mockedCommit.mockResolvedValue({ success: "Imported 1 row" })
    const user = userEvent.setup()
    render(<ImportClient custodians={custodians} />)

    await setCsvAndCustodian(user)
    await user.click(screen.getByRole("button", { name: "Preview" }))

    const commit = await screen.findByRole("button", { name: "Commit import" })
    expect(commit).toBeEnabled()
    await user.click(commit)

    expect(await screen.findByText("Imported 1 row")).toBeInTheDocument()
    // preview table gone + Preview re-disabled (csv was cleared)
    expect(screen.queryByRole("button", { name: "Commit import" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled()
  })
})
