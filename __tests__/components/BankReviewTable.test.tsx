/**
 * @jest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BankReviewTable } from "@/components/accounting/BankReviewTable"
import type { ReviewRow, Account, Family } from "@/components/accounting/BankReviewTable"

// Render the shadcn Select as a plain native <select> — this test drives
// BankReviewTable's row/category state machine, not Radix internals, and the
// existing assertions query <option> elements directly (matches the pattern
// already used in petty-cash-ImportClient.test.tsx).
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
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

const families: Family[] = [
  {
    id: 1,
    name: "Smith",
    people: [{ id: 10, firstName: "John", lastName: "Smith", bankingName: null }],
  },
  {
    id: 2,
    name: "Jones",
    people: [{ id: 20, firstName: "Mary", lastName: "Jones", bankingName: "M J PAYMENTS" }],
  },
]

function makeRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    date: "2026-05-01",
    description: "PAYMENT FROM JOHN SMITH",
    details: "PAYMENT FROM JOHN SMITH | 123456789 | REF TITHE",
    amount: "500.00",
    type: "INCOME",
    bankRef: "ANZ_12345_20260501_500.00_PAYMENTFROMJOHN_5000000",
    dedupKey: "12345_20260501_500.00_PAYMENTFROMJOHN",
    accountId: 1,
    skip: false,
    isDuplicate: false,
    familyId: 1,
    personId: 10,
    fromPettyCash: false,
    ...overrides,
  }
}

const baseProps = {
  rows: [makeRow()],
  period: { from: "2026-05-01", to: "2026-05-31" },
  parseErrors: [],
  accounts,
  families,
  importError: null,
  importing: false,
  onUpdateRow: jest.fn(),
  onSetAllCategory: jest.fn(),
  onToggleSkipAll: jest.fn(),
  onConfirm: jest.fn(),
  onBack: jest.fn(),
}

describe("BankReviewTable description cell", () => {
  it("renders primary description text", () => {
    render(<BankReviewTable {...baseProps} />)
    const table = screen.getByRole("table")
    expect(within(table).getByText("PAYMENT FROM JOHN SMITH")).toBeInTheDocument()
  })

  it("renders extra details lines when details has more than one segment", () => {
    render(<BankReviewTable {...baseProps} />)
    const table = screen.getByRole("table")
    expect(within(table).getByText("123456789 | REF TITHE")).toBeInTheDocument()
  })

  it("does not render extra line when description and details are identical", () => {
    const row = makeRow({
      description: "PAYMENT FROM JOHN SMITH",
      details: "PAYMENT FROM JOHN SMITH",
    })
    render(<BankReviewTable {...baseProps} rows={[row]} />)
    const table = screen.getByRole("table")
    const cell = within(table).getByText("PAYMENT FROM JOHN SMITH").closest("td")
    expect(cell?.querySelectorAll(".text-muted-foreground")).toHaveLength(0)
  })

  it("does not render extra line when details is empty", () => {
    const row = makeRow({ description: "TRANSFER", details: "" })
    render(<BankReviewTable {...baseProps} rows={[row]} />)
    const table = screen.getByRole("table")
    expect(within(table).getByText("TRANSFER")).toBeInTheDocument()
    const cell = within(table).getByText("TRANSFER").closest("td")
    expect(cell?.querySelectorAll(".text-muted-foreground")).toHaveLength(0)
  })
})

describe("BankReviewTable amount cell", () => {
  it("uses the house .tabular utility, not font-mono", () => {
    render(<BankReviewTable {...baseProps} />)
    const table = screen.getByRole("table")
    const cell = within(table).getByText("PAYMENT FROM JOHN SMITH").closest("tr")!.querySelector("td:nth-child(3)")
    expect(cell?.className).toMatch(/\btabular\b/)
    expect(cell?.className).not.toMatch(/font-mono/)
  })
})

describe("BankReviewTable category select — filtered by row type", () => {
  it("INCOME row offers only income accounts", () => {
    render(<BankReviewTable {...baseProps} rows={[makeRow({ type: "INCOME" })]} />)
    const table = screen.getByRole("table")
    const tr = within(table).getByText("PAYMENT FROM JOHN SMITH").closest("tr")!
    expect(within(tr).getByRole("option", { name: "4001 — Tithes" })).toBeInTheDocument()
    expect(within(tr).queryByRole("option", { name: "5001 — Maintenance" })).not.toBeInTheDocument()
  })

  it("EXPENSE row offers only expense accounts", () => {
    render(<BankReviewTable {...baseProps} rows={[makeRow({ type: "EXPENSE", accountId: null })]} />)
    const table = screen.getByRole("table")
    const tr = within(table).getByText("PAYMENT FROM JOHN SMITH").closest("tr")!
    expect(within(tr).getByRole("option", { name: "5001 — Maintenance" })).toBeInTheDocument()
    expect(within(tr).queryByRole("option", { name: "4001 — Tithes" })).not.toBeInTheDocument()
  })

  it("Set all dropdown still offers both types", () => {
    render(<BankReviewTable {...baseProps} />)
    const setAll = screen.getByText("— category —").closest("select")!
    expect(within(setAll).getByRole("option", { name: "4001 — Tithes" })).toBeInTheDocument()
    expect(within(setAll).getByRole("option", { name: "5001 — Maintenance" })).toBeInTheDocument()
  })
})

describe("BankReviewTable member combobox", () => {
  it("shows the selected member with family in the trigger", () => {
    render(<BankReviewTable {...baseProps} />)
    const table = screen.getByRole("table")
    const trigger = within(table).getByRole("combobox", { name: "Member" })
    expect(trigger).toHaveTextContent("John Smith (Smith)")
  })

  it("shows — none — when no member selected", () => {
    render(<BankReviewTable {...baseProps} rows={[makeRow({ personId: null, familyId: null })]} />)
    const table = screen.getByRole("table")
    expect(within(table).getByRole("combobox", { name: "Member" })).toHaveTextContent("— none —")
  })

  it("filters by bankingName and selects with derived familyId", async () => {
    const user = userEvent.setup()
    const onUpdateRow = jest.fn()
    render(<BankReviewTable {...baseProps} onUpdateRow={onUpdateRow} />)

    const table = screen.getByRole("table")
    await user.click(within(table).getByRole("combobox", { name: "Member" }))
    await user.type(screen.getByPlaceholderText("Type a name…"), "M J PAY")

    const listbox = screen.getByRole("listbox")
    expect(within(listbox).getByText("Mary Jones (Jones)")).toBeInTheDocument()
    expect(within(listbox).queryByText("John Smith (Smith)")).not.toBeInTheDocument()

    await user.click(within(listbox).getByText("Mary Jones (Jones)"))
    expect(onUpdateRow).toHaveBeenCalledWith(0, { personId: 20, familyId: 2 })
  })

  it("filters by first/last name", async () => {
    const user = userEvent.setup()
    render(<BankReviewTable {...baseProps} />)

    const table = screen.getByRole("table")
    await user.click(within(table).getByRole("combobox", { name: "Member" }))
    await user.type(screen.getByPlaceholderText("Type a name…"), "Mary")

    const listbox = screen.getByRole("listbox")
    expect(within(listbox).getByText("Mary Jones (Jones)")).toBeInTheDocument()
    expect(within(listbox).queryByText("John Smith (Smith)")).not.toBeInTheDocument()
  })

  it("clears both personId and familyId via — none —", async () => {
    const user = userEvent.setup()
    const onUpdateRow = jest.fn()
    render(<BankReviewTable {...baseProps} onUpdateRow={onUpdateRow} />)

    const table = screen.getByRole("table")
    await user.click(within(table).getByRole("combobox", { name: "Member" }))
    await user.click(within(screen.getByRole("listbox")).getByText("— none —"))

    expect(onUpdateRow).toHaveBeenCalledWith(0, { personId: null, familyId: null })
  })

  it("is disabled when the row is skipped", () => {
    render(<BankReviewTable {...baseProps} rows={[makeRow({ skip: true })]} />)
    const table = screen.getByRole("table")
    expect(within(table).getByRole("combobox", { name: "Member" })).toBeDisabled()
  })
})

describe("BankReviewTable split", () => {
  it("seeds a single full-amount line when Split is clicked", async () => {
    const user = userEvent.setup()
    const onUpdateRow = jest.fn()
    render(<BankReviewTable {...baseProps} onUpdateRow={onUpdateRow} />)
    const table = screen.getByRole("table")
    await user.click(within(table).getByRole("button", { name: "Split…" }))
    expect(onUpdateRow).toHaveBeenCalledWith(0, {
      // `_key` is a client-only stable React key — assert the payload
      // fields without pinning the generated key value.
      splits: [
        expect.objectContaining({ accountId: 1, familyId: 1, personId: 10, amount: "500.00" }),
      ],
    })
  })

  it("disables import while split allocations do not sum to the row total", () => {
    const row = makeRow({
      splits: [
        { accountId: 1, amount: "300.00", familyId: null, personId: null },
        { accountId: 1, amount: "100.00", familyId: null, personId: null },
      ],
    })
    render(<BankReviewTable {...baseProps} rows={[row]} />)
    const table = screen.getByRole("table")
    expect(within(table).getByText(/unallocated/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Import/ })).toBeDisabled()
  })

  it("enables import once split allocations sum to the row total", () => {
    const row = makeRow({
      splits: [
        { accountId: 1, amount: "300.00", familyId: null, personId: null },
        { accountId: 1, amount: "200.00", familyId: null, personId: null },
      ],
    })
    render(<BankReviewTable {...baseProps} rows={[row]} />)
    const table = screen.getByRole("table")
    expect(within(table).getByText("fully allocated")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Import/ })).not.toBeDisabled()
  })

  // newly added lines carry a stable client `_key` so a line's row (and
  // its member-combobox popover) tracks the data, not the array index, when an
  // earlier line is removed.
  it("assigns a stable client key to newly added split lines", async () => {
    const user = userEvent.setup()
    const onUpdateRow = jest.fn()
    const row = makeRow({
      splits: [{ accountId: 1, amount: "300.00", familyId: null, personId: null }],
    })
    render(<BankReviewTable {...baseProps} rows={[row]} onUpdateRow={onUpdateRow} />)
    const table = screen.getByRole("table")
    await user.click(within(table).getByRole("button", { name: "+ Add line" }))
    const appended = onUpdateRow.mock.calls.at(-1)![1].splits.at(-1)
    expect(typeof appended._key).toBe("string")
    expect(appended._key.length).toBeGreaterThan(0)
  })
})
