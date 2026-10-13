import { render, screen } from "@testing-library/react"
import { BankUploadStep } from "@/components/accounting/BankUploadStep"

const accounts = [{ id: 1, name: "Main Bank Account", kind: "BANK", isDefault: true, isActive: true }] as never

describe("BankUploadStep", () => {
  it("shows the PDF picker as a styled button, not bare preflight-reset text", () => {
    render(<BankUploadStep paymentAccounts={accounts} onUploadComplete={jest.fn()} />)
    const picker = screen.getByLabelText("Statement PDF *")
    expect(picker).toHaveAttribute("type", "file")
    expect(picker).toHaveAttribute("accept", "application/pdf")
    // Tailwind preflight removes the native button's border/background; these restore a visible button.
    expect(picker.className).toEqual(expect.stringContaining("file:bg-primary"))
    expect(picker.className).toEqual(expect.stringContaining("file:px-3"))
    expect(screen.getByRole("button", { name: "Parse Statement" })).toBeEnabled()
  })
})
