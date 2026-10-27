/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { BankImportClient } from "@/components/accounting/BankImportClient"
import { rememberBankImportAccount } from "@/lib/actions/bankImport"

jest.mock("@/lib/actions/bankImport", () => ({ rememberBankImportAccount: jest.fn().mockResolvedValue({ success: true }) }))

// Native <select> stand-in for the shadcn Select — same mock as BankImportClient.draft.test.tsx.
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select value={value ?? ""} disabled={disabled} onChange={(e: any) => onValueChange?.(e.target.value)}>
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

const paymentAccounts = [{ id: 1, name: "Operating", kind: "BANK", isDefault: true, isActive: true }] as never
const accounts = [{ id: 10, code: "4000", name: "Tithes", type: "INCOME" as const }]

beforeEach(() => {
  sessionStorage.clear()
  jest.mocked(rememberBankImportAccount).mockClear()
  global.fetch = jest.fn((url: string) => {
    if (url.endsWith("/confirm")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ imported: 1, skipped: 0, duplicates: 0 }) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      rows: [{ date: "2026-09-02", description: "X", details: "", amount: "1.00", type: "INCOME", bankRef: "OFX_a", dedupKey: "a" }],
      duplicateBankRefs: [], possibleDuplicateBankRefs: [], period: { from: "2026-09-01", to: "2026-09-30" },
      accountNumber: "000111224821", suggestedPaymentAccountId: null, dateFormatAmbiguous: false, errors: [],
    }) })
  }) as never
})

it("walks Source → Upload → Review → Done and remembers the account", async () => {
  render(<BankImportClient accounts={accounts} families={[]} paymentAccounts={paymentAccounts} />)
  expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("radio", { name: /OFX \/ QFX/ }))
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.change(screen.getByLabelText(/Statement file/i), { target: { files: [new File(["x"], "s.ofx")] } })
  await screen.findByText(/1 row/)
  fireEvent.click(screen.getByRole("button", { name: "Continue to review" }))
  expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument()
  const tr = within(screen.getByRole("table")).getByText("X").closest("tr")!
  fireEvent.change(tr.querySelector("select")!, { target: { value: "10" } })
  fireEvent.click(screen.getAllByRole("button", { name: "Import 1 transaction" })[0])
  expect(await screen.findByText(/Step 4 of 4/)).toBeInTheDocument()
  expect(screen.getByText("Import complete")).toBeInTheDocument()
  await waitFor(() => expect(rememberBankImportAccount).toHaveBeenCalledWith("000111224821", 1))
})

it("marks possible duplicates skipped on upload", async () => {
  ;(global.fetch as jest.Mock).mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({
    rows: [{ date: "2026-09-02", description: "X", details: "", amount: "1.00", type: "INCOME", bankRef: "OFX_a", dedupKey: "a" }],
    duplicateBankRefs: [], possibleDuplicateBankRefs: ["OFX_a"], period: null,
    accountNumber: "", suggestedPaymentAccountId: null, dateFormatAmbiguous: false, errors: [],
  }) }))
  render(<BankImportClient accounts={accounts} families={[]} paymentAccounts={paymentAccounts} />)
  fireEvent.click(screen.getByRole("radio", { name: /OFX \/ QFX/ }))
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.change(screen.getByLabelText(/Statement file/i), { target: { files: [new File(["x"], "s.ofx")] } })
  await screen.findByText(/1 row/)
  fireEvent.click(screen.getByRole("button", { name: "Continue to review" }))
  expect(screen.getAllByText("POSSIBLE DUPLICATE").length).toBeGreaterThan(0)
  expect(rememberBankImportAccount).not.toHaveBeenCalled()
})
