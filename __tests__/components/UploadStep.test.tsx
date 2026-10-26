/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
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

  it("QIF ambiguous dates: toggle stays visible after a pick so it can be undone", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(okBody({ dateFormatAmbiguous: true })) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(okBody({ dateFormatAmbiguous: false })) }) as never
    render(<UploadStep source="qif" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("s.qif")
    fireEvent.click(await screen.findByRole("radio", { name: "MM/DD" }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole("radio", { name: "MM/DD" })).toHaveAttribute("aria-checked", "true"))
    expect(screen.getByRole("radio", { name: "DD/MM" })).toBeInTheDocument()
  })

  it("shows the server error", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "This looks like a QIF file — go back and choose QIF" }) }) as never
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick()
    expect(await screen.findByRole("alert")).toHaveTextContent("go back and choose QIF")
  })
  it("ignores a stale response that resolves after a newer request", async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    const first = new Promise((r) => { resolveFirst = r })
    global.fetch = jest.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(okBody({ suggestedPaymentAccountId: 1, rows: [] })) }) as never
    const onComplete = jest.fn()
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={onComplete} />)
    pick("a.ofx")
    pick("b.ofx")
    await screen.findByText(/0 rows/)
    await act(async () => {
      resolveFirst({ ok: true, json: () => Promise.resolve(okBody({ suggestedPaymentAccountId: 3 })) })
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(screen.getByText(/0 rows/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Continue to review" }))
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ paymentAccountId: 1, rows: [] }))
    expect(screen.getByText("b.ofx")).toBeInTheDocument()
  })

  it("keeps uploading true until the latest request settles", async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    const first = new Promise((r) => { resolveFirst = r })
    const second = new Promise(() => {})
    global.fetch = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) as never
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("a.ofx")
    pick("b.ofx")
    await act(async () => {
      resolveFirst({ ok: true, json: () => Promise.resolve(okBody()) })
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(screen.getByText("Reading file…")).toBeInTheDocument()
  })

  it("rejects a file outside the accept list without reading it", () => {
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("notes.txt")
    expect(screen.getByRole("alert")).toHaveTextContent(/\.ofx, \.qfx/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("accepts a PDF by extension for ANZ", async () => {
    render(<UploadStep source="anz" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("Statement.PDF")
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  })

  it("keeps the drop highlight while dragging over child elements", () => {
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    const zone = screen.getByText("Drop file here").closest("label") as HTMLElement
    const child = screen.getByText("Drop file here")
    fireEvent.dragEnter(zone)
    fireEvent.dragEnter(child)
    fireEvent.dragLeave(zone)
    expect(zone.className).toContain("border-primary")
    fireEvent.dragLeave(child)
    expect(zone.className).not.toContain("border-primary bg-secondary")
  })

  it("shows a keyboard focus ring on the picker label", () => {
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    const zone = screen.getByText("Drop file here").closest("label") as HTMLElement
    expect(zone.className).toMatch(/focus-visible/)
  })

  it("shows size limit and accept label from the source config", () => {
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    expect(screen.getByText(/\.ofx, \.qfx · max 50 MB · one file/)).toBeInTheDocument()
  })

  it("QIF: date-order toggle stays visible when the re-read fails", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(okBody({ dateFormatAmbiguous: true })) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: "bad dates" }) }) as never
    render(<UploadStep source="qif" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("s.qif")
    fireEvent.click(await screen.findByRole("radio", { name: "MM/DD" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("bad dates")
    expect(screen.getByRole("radio", { name: "DD/MM" })).toBeInTheDocument()
  })

  it("resets the suggested account when a new file has no match", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(okBody({ suggestedPaymentAccountId: 3 })) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(okBody({ suggestedPaymentAccountId: null })) }) as never
    const onComplete = jest.fn()
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={onComplete} />)
    pick("a.ofx")
    await screen.findByText("Auto-matched from file")
    pick("b.ofx")
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue to review" })).toBeEnabled())
    expect(screen.queryByText("Auto-matched from file")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Continue to review" }))
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ paymentAccountId: 1 }))
  })

  it("clears the previous parse when a replacement file fails with a network error", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(okBody()) })
      .mockRejectedValueOnce(new Error("offline")) as never
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("a.ofx")
    await screen.findByRole("button", { name: "Continue to review" })
    pick("b.ofx")
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error")
    expect(screen.getByRole("button", { name: "Continue to review" })).toBeDisabled()
  })

  it("QIF: keeps the date-order toggle mounted while a re-read is pending", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(okBody({ dateFormatAmbiguous: true })) })
      .mockReturnValueOnce(new Promise(() => {})) as never
    render(<UploadStep source="qif" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("s.qif")
    const mdy = await screen.findByRole("radio", { name: "MM/DD" })
    mdy.focus()
    fireEvent.click(mdy)
    await screen.findByText(/Reading file/)
    expect(screen.getByRole("radio", { name: "MM/DD" })).toHaveFocus()
  })

  it("resets the file input so the same file can be picked again", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(okBody()) }) as never
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    const input = screen.getByLabelText(/Statement file/i) as HTMLInputElement
    const setValue = jest.spyOn(input, "value", "set")
    pick("a.ofx")
    expect(setValue).toHaveBeenCalledWith("")
    await screen.findByRole("button", { name: "Continue to review" })
  })
})
