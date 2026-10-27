/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react"
import { ImportStepper } from "@/components/accounting/import/ImportStepper"
import { ReviewFilterTabs } from "@/components/accounting/import/ReviewFilterTabs"
import { SourceStep } from "@/components/accounting/import/SourceStep"
import { UploadStep } from "@/components/accounting/import/UploadStep"
import { DoneStep } from "@/components/accounting/import/DoneStep"

describe("ImportStepper", () => {
  it("marks earlier steps done and the current step active", () => {
    render(<ImportStepper current="review" />)
    expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument()
    expect(screen.getByRole("listitem", { name: /Review/ })).toHaveAttribute("aria-current", "step")
    expect(screen.getByRole("listitem", { name: /Upload, completed/ })).toBeInTheDocument()
  })
})

describe("SourceStep", () => {
  it("selects a source and continues", () => {
    const onChange = jest.fn()
    const onContinue = jest.fn()
    render(<SourceStep value="anz" onChange={onChange} onContinue={onContinue} />)
    fireEvent.click(screen.getByRole("radio", { name: /OFX \/ QFX/ }))
    expect(onChange).toHaveBeenCalledWith("ofx")
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(onContinue).toHaveBeenCalled()
  })

  it("uses roving tabindex and arrow keys between sources", () => {
    const onChange = jest.fn()
    render(<SourceStep value="anz" onChange={onChange} onContinue={jest.fn()} />)
    const anz = screen.getByRole("radio", { name: /ANZ statement/ })
    const ofx = screen.getByRole("radio", { name: /OFX \/ QFX/ })
    expect(anz).toHaveAttribute("tabindex", "0")
    expect(ofx).toHaveAttribute("tabindex", "-1")
    anz.focus()
    fireEvent.keyDown(anz, { key: "ArrowRight" })
    expect(onChange).toHaveBeenCalledWith("ofx")
    expect(ofx).toHaveFocus()
  })

  it("shows AI import disabled as coming soon", () => {
    render(<SourceStep value="anz" onChange={jest.fn()} onContinue={jest.fn()} />)
    const ai = screen.getByRole("radio", { name: /AI import/ })
    expect(ai).toBeDisabled()
    expect(screen.getByText("Coming soon")).toBeInTheDocument()
  })
})

describe("ReviewFilterTabs", () => {
  it("groups the pressed-state buttons under a labelled group", () => {
    const stats = { total: 3, needsCategory: 1, matched: 0, duplicates: 0, skipped: 0, incomeCents: 0, expenseCents: 0 }
    render(<ReviewFilterTabs value="all" stats={stats} onChange={jest.fn()} />)
    const group = screen.getByRole("group", { name: "Filter rows" })
    expect(group).toContainElement(screen.getByRole("button", { name: /Needs category 1/ }))
  })
})

describe("step headings", () => {
  it("render as h3 for heading navigation", () => {
    const { unmount } = render(<SourceStep value="anz" onChange={() => {}} onContinue={() => {}} />)
    expect(screen.getByRole("heading", { level: 3, name: "Where is your data from?" })).toBeTruthy()
    unmount()
    const u = render(<UploadStep source="ofx" paymentAccounts={[]} onBack={() => {}} onComplete={() => {}} />)
    expect(screen.getByRole("heading", { level: 3, name: /Upload your/ })).toBeTruthy()
    u.unmount()
    render(<DoneStep result={null} onAgain={() => {}} />)
    expect(screen.getByRole("heading", { level: 3, name: "Import complete" })).toBeTruthy()
  })
})

describe("UploadStep file validation", () => {
  it("rejects an oversize file client-side without calling the API", () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    render(<UploadStep source="ofx" paymentAccounts={[]} onBack={() => {}} onComplete={() => {}} />)
    const big = new File(["x"], "big.ofx")
    Object.defineProperty(big, "size", { value: 51 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText("Statement file"), { target: { files: [big] } })
    expect(screen.getByRole("alert").textContent).toMatch(/too large/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows an error and no summary when the response has no rows array", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
    render(<UploadStep source="ofx" paymentAccounts={[]} onBack={() => {}} onComplete={() => {}} />)
    fireEvent.change(screen.getByLabelText("Statement file"), { target: { files: [new File(["x"], "a.ofx")] } })
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't read/)
    expect(screen.queryByText("Read")).toBeNull()
  })
})
