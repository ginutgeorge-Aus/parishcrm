/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { rememberBankImportAccount } from "@/lib/actions/bankImport"
import { BankImportClient } from "@/components/accounting/BankImportClient"
import type { Account, Family, ReviewRow } from "@/components/accounting/BankReviewTable"

jest.mock("@/lib/actions/bankImport", () => ({ rememberBankImportAccount: jest.fn().mockResolvedValue({ success: true }) }))

jest.mock("@/components/accounting/import/UploadStep", () => ({
  // "mock-complete" hands BankImportClient whatever upload the test parked on globalThis.
  UploadStep: ({ source, onComplete }: { source: string; onComplete: (u: unknown) => void }) => (
    <div data-testid="upload-step" data-source={source}>
      <button onClick={() => onComplete((globalThis as { mockNextUpload?: unknown }).mockNextUpload)}>mock-complete</button>
    </div>
  ),
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

function seedDraft(rows: ReviewRow[], extra: object = {}) {
  sessionStorage.setItem(
    "bankImportDraft.v3",
    JSON.stringify({ rows, period: { from: "2026-05-01", to: "2026-05-31" }, paymentAccountId: 1, ...extra })
  )
}

beforeEach(() => {
  sessionStorage.clear()
  jest.restoreAllMocks()
})

describe("BankImportClient draft persistence", () => {
  it("starts at the source step, then upload, when no draft exists", async () => {
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    expect(screen.queryByTestId("upload-step")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Continue" }))
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
      const stored = JSON.parse(sessionStorage.getItem("bankImportDraft.v3")!)
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

    await user.click(screen.getAllByRole("button", { name: /Import 1 transaction/ })[0])

    expect(await screen.findByText("Import complete")).toBeInTheDocument()
    expect(sessionStorage.getItem("bankImportDraft.v3")).toBeNull()
  })

  it("sends masked rows plus the sealed account token on confirm (#446)", async () => {
    seedDraft([makeRow({ bankRef: "ANZ_*4321_20260501_100.00_PAYMENTFROMJOHN_1" })], { accountToken: "enc:v1:aXY=:dGFn:Y3Q=", accountFingerprint: "a".repeat(64) })
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ imported: 1, skipped: 0, duplicates: 0 }) })
    global.fetch = fetchMock as jest.Mock
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    await screen.findByRole("table")

    await user.click(screen.getAllByRole("button", { name: /Import 1 transaction/ })[0])

    expect(await screen.findByText("Import complete")).toBeInTheDocument()
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.accountToken).toBe("enc:v1:aXY=:dGFn:Y3Q=")
    expect(sent.rows[0].bankRef).toBe("ANZ_*4321_20260501_100.00_PAYMENTFROMJOHN_1")
    expect(sent.rows[0].paymentAccountId).toBe(1)
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

    await user.click(screen.getAllByRole("button", { name: /Import 1 transaction/ })[0])

    expect((await screen.findAllByText(/category is inactive/)).length).toBeGreaterThan(0)
    expect(sessionStorage.getItem("bankImportDraft.v3")).not.toBeNull()
  })

  it("recovers from a network throw — shows an error and re-enables Import", async () => {
    seedDraft([makeRow()])
    global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as jest.Mock
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    await screen.findByRole("table")

    const importBtn = screen.getAllByRole("button", { name: /Import 1 transaction/ })[0]
    await user.click(importBtn)

    expect((await screen.findAllByText(/Network error/i)).length).toBeGreaterThan(0)
    // Button is no longer stuck disabled — the user can retry.
    expect(screen.getAllByRole("button", { name: /Import 1 transaction/ })[0]).toBeEnabled()
    expect(sessionStorage.getItem("bankImportDraft.v3")).not.toBeNull()
  })

  it("persists accountSuffix and source in the draft", async () => {
    seedDraft([makeRow({ accountId: null })], { accountSuffix: "0111", source: "ofx" })
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    const table = await screen.findByRole("table")
    await user.selectOptions(within(table).getByText("PAYMENT FROM JOHN").closest("tr")!.querySelector("select")!, "1")
    await waitFor(() => {
      const stored = JSON.parse(sessionStorage.getItem("bankImportDraft.v3")!)
      expect(stored.accountSuffix).toBe("0111")
      expect(stored.source).toBe("ofx")
    })
  })

  it("restores the saved source when going back to upload", async () => {
    seedDraft([makeRow()], { accountSuffix: "0111", source: "ofx" })
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    await screen.findByRole("table")
    await user.click(screen.getByRole("button", { name: "← Back" }))
    expect(screen.getByTestId("upload-step")).toHaveAttribute("data-source", "ofx")
  })

  it("remembers the restored account suffix after a successful import", async () => {
    seedDraft([makeRow()], { accountSuffix: "0111", source: "ofx" })
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ imported: 1, skipped: 0, duplicates: 0 }) }) as jest.Mock
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    await screen.findByRole("table")
    await user.click(screen.getAllByRole("button", { name: /Import 1 transaction/ })[0])
    await screen.findByText("Import complete")
    expect(rememberBankImportAccount).toHaveBeenCalledWith("0111", 1)
  })

  it("startOver resets source and account number", async () => {
    seedDraft([makeRow()], { accountSuffix: "0111", source: "ofx" })
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ imported: 1, skipped: 0, duplicates: 0 }) }) as jest.Mock
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    await screen.findByRole("table")
    await user.click(screen.getAllByRole("button", { name: /Import 1 transaction/ })[0])
    await user.click(await screen.findByRole("button", { name: "Import another file" }))
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByTestId("upload-step")).toHaveAttribute("data-source", "anz")
  })

  // #449 round 2: a re-upload for a different account (same masked refs) must
  // not inherit selections — and must say so instead of dropping them silently.
  it("tells the user when a re-upload for another account drops their selections", async () => {
    const ref = "ANZ_*4321_20260501_100.00_PAYMENTFROMJOHN_1"
    seedDraft([makeRow({ bankRef: ref, accountId: 1 })], { accountToken: "enc:v1:a:b:c", accountFingerprint: "a".repeat(64) })
    ;(globalThis as { mockNextUpload?: unknown }).mockNextUpload = {
      rows: [{ date: "2026-05-01", description: "PAYMENT FROM JOHN", details: "", amount: "100.00", type: "INCOME", bankRef: ref, dedupKey: "" }],
      duplicateBankRefs: [],
      possibleDuplicateBankRefs: [],
      period: { from: "2026-05-01", to: "2026-05-31" },
      paymentAccountId: 1,
      accountSuffix: "4321",
      accountToken: "enc:v1:d:e:f",
      accountFingerprint: "b".repeat(64),
      errors: [],
    }
    const user = userEvent.setup()
    render(<BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />)
    await screen.findByRole("table")
    await user.click(screen.getByRole("button", { name: "← Back" }))
    await user.click(screen.getByRole("button", { name: "mock-complete" }))
    expect(await screen.findByText(/different bank account/i)).toBeInTheDocument()
    await waitFor(() => {
      const stored = JSON.parse(sessionStorage.getItem("bankImportDraft.v3")!)
      expect(stored.rows[0].accountId).toBeNull()
      expect(stored.accountFingerprint).toBe("b".repeat(64))
    })
  })
})
