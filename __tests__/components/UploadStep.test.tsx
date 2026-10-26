/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { UploadStep } from "@/components/accounting/import/UploadStep"

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

const accounts = [
  { id: 1, name: "Operating", kind: "BANK", isDefault: true, isActive: true },
  { id: 3, name: "Building Fund", kind: "BANK", isDefault: false, isActive: true },
] as never

const okBody = (extra: object = {}) => ({
  rows: [{ date: "2026-09-02", description: "X", details: "", amount: "1.00", type: "INCOME", bankRef: "OFX_a", dedupKey: "a" }],
  duplicateBankRefs: [], possibleDuplicateBankRefs: [], period: { from: "2026-09-01", to: "2026-09-30" },
  accountNumber: "000111224821", suggestedPaymentAccountId: 3, dateFormatAmbiguous: false, errors: [], ...extra,
})

function pick(name = "s.ofx") {
  const input = screen.getByLabelText(/Statement file/i) as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(["x"], name)] } })
}

describe("UploadStep", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(okBody()) }) as never
  })

  it("sets accept per source and shows export help", () => {
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    expect(screen.getByLabelText(/Statement file/i)).toHaveAttribute("accept", ".ofx,.qfx")
    expect(screen.getByText(/export transactions as OFX/)).toBeInTheDocument()
  })

  it("reads the file, shows a summary, auto-matches the account, and continues", async () => {
    const onComplete = jest.fn()
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={onComplete} />)
    pick()
    await screen.findByText(/1 row/)
    expect(screen.getByText(/••• 4821/)).toBeInTheDocument()
    expect(screen.getByText("Auto-matched from file")).toBeInTheDocument()
    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData
    expect(body.get("source")).toBe("ofx")
    fireEvent.click(screen.getByRole("button", { name: "Continue to review" }))
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ paymentAccountId: 3, accountNumber: "000111224821" }))
  })

  it("QIF: requires an account first and sends it", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(okBody({ suggestedPaymentAccountId: null, accountNumber: "" })) }) as never
    render(<UploadStep source="qif" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("s.qif")
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData
    expect(body.get("paymentAccountId")).toBe("1") // default BANK pre-selected
  })

  it("QIF ambiguous dates: toggling re-reads with dateOrder", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(okBody({ dateFormatAmbiguous: true })) }) as never
    render(<UploadStep source="qif" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("s.qif")
    fireEvent.click(await screen.findByRole("radio", { name: "MM/DD" }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(((global.fetch as jest.Mock).mock.calls[1][1].body as FormData).get("dateOrder")).toBe("MDY")
  })

  it("shows the server error", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "This looks like a QIF file — go back and choose QIF" }) }) as never
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick()
    expect(await screen.findByRole("alert")).toHaveTextContent("go back and choose QIF")
  })
})
