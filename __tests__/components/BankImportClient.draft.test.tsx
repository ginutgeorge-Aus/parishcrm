/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BankImportClient } from "@/components/accounting/BankImportClient"
import type { Account, Family, ReviewRow } from "@/components/accounting/BankReviewTable"

jest.mock("@/components/accounting/BankUploadStep", () => ({
  BankUploadStep: () => <div data-testid="upload-step" />,
}))

// Render the shadcn Select as a plain native <select> — this test drives
// BankImportClient's draft-persistence logic, not Radix internals (same
// pattern as petty-cash-ImportClient.test.tsx).
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e: any) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => (placeholder ? <option value="">{placeholder}</option> : null),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectGroup: ({ children }: any) => <>{children}</>,
  SelectLabel: () => null,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

const accounts: Account[] = [
  { id: 1, code: "4001", name: "Tithes", type: "INCOME" },
  { id: 2, code: "5001", name: "Maintenance", type: "EXPENSE" },
]
const families: Family[] = []
const paymentAccounts = [{ id: 1, name: "ANZ Church", kind: "BANK" as const, isDefault: true, isActive: true }]

function makeRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    date: "2026-05-01",
    description: "PAYMENT FROM JOHN",
    details: "",
    amount: "100.00",
    type: "INCOME",
    bankRef: "ANZ_1",
    dedupKey: "",
    accountId: 1,
    skip: false,
    isDuplicate: false,
    familyId: null,
    personId: null,
    fromPettyCash: false,
    ...overrides,
  }
}

function seedDraft(rows: ReviewRow[]) {
  sessionStorage.setItem(
    "bankImportDraft.v1",
    JSON.stringify({ rows, period: { from: "2026-05-01", to: "2026-05-31" }, paymentAccountId: 1 })
  )
}

beforeEach(() => {
  sessionStorage.clear()
  jest.restoreAllMocks()
})

describe("BankImportClient draft persistence", () => {
  it("starts at upload step when no draft exists", () => {
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    expect(screen.getByTestId("upload-step")).toBeInTheDocument()
  })

  it("restores a saved draft straight into the review step", async () => {
    seedDraft([makeRow()])
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    const table = await screen.findByRole("table")
    expect(within(table).getByText("PAYMENT FROM JOHN")).toBeInTheDocument()
    expect(screen.queryByTestId("upload-step")).not.toBeInTheDocument()
  })

  it("saves the draft when a selection changes in review", async () => {
    seedDraft([makeRow({ accountId: null })])
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    const table = await screen.findByRole("table")

    const tr = within(table).getByText("PAYMENT FROM JOHN").closest("tr")!
    await user.selectOptions(tr.querySelector("select")!, "1")

    await waitFor(() => {
      const stored = JSON.parse(sessionStorage.getItem("bankImportDraft.v1")!)
      expect(stored.rows[0].accountId).toBe(1)
    })
  })

  it("clears the draft after a successful import", async () => {
    seedDraft([makeRow()])
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ imported: 1, skipped: 0, duplicates: 0 }),
    }) as jest.Mock
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    await screen.findByRole("table")

    await user.click(screen.getByRole("button", { name: /Import 1 transaction/ }))

    expect(await screen.findByText("Import Complete")).toBeInTheDocument()
    expect(sessionStorage.getItem("bankImportDraft.v1")).toBeNull()
  })

  it("keeps the draft when import fails", async () => {
    seedDraft([makeRow()])
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid category for \"PAYMENT FROM JOHN\" (2026-05-01): the selected category is inactive" }),
    }) as jest.Mock
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    await screen.findByRole("table")

    await user.click(screen.getByRole("button", { name: /Import 1 transaction/ }))

    expect(await screen.findByText(/category is inactive/)).toBeInTheDocument()
    expect(sessionStorage.getItem("bankImportDraft.v1")).not.toBeNull()
  })

  it("recovers from a network throw — shows an error and re-enables Import", async () => {
    seedDraft([makeRow()])
    global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as jest.Mock
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    await screen.findByRole("table")

    const importBtn = screen.getByRole("button", { name: /Import 1 transaction/ })
    await user.click(importBtn)

    expect(await screen.findByText(/Network error/i)).toBeInTheDocument()
    // Button is no longer stuck disabled — the user can retry.
    expect(screen.getByRole("button", { name: /Import 1 transaction/ })).toBeEnabled()
    expect(sessionStorage.getItem("bankImportDraft.v1")).not.toBeNull()
  })
})
