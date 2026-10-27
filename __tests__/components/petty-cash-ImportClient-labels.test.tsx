/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ImportClient } from "@/components/petty-cash/ImportClient"
import { previewImport } from "@/lib/actions/pettyCashImport"

jest.mock("@/lib/actions/pettyCashImport", () => ({
  previewImport: jest.fn(),
  commitImport: jest.fn(),
}))

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

const CSV = "date,type,amount\n2026-01-01,IN,10"

test("preview table header uses sentence case for Payee/donor", async () => {
  ;(previewImport as jest.Mock).mockResolvedValue({
    preview: {
      rows: [
        {
          rowNumber: 1,
          rawDate: "2026-01-01",
          type: "Receipt",
          accountName: "Donations",
          payeeOrDonor: "Sample Donor",
          amount: 10,
          errors: [],
          donor: { status: "none" },
        },
      ],
      sessions: ["01-JAN-2026"],
      receiptTotal: 10,
      expenseTotal: 0,
      hardErrorCount: 0,
    },
  })
  const user = userEvent.setup()
  render(<ImportClient custodians={[{ id: 1, name: "Alice" }]} />)
  const f = new File([CSV], "petty.csv", { type: "text/csv" })
  Object.defineProperty(f, "text", { value: () => Promise.resolve(CSV) })
  await user.upload(screen.getByLabelText("CSV file"), f)
  await user.selectOptions(screen.getByLabelText("Custodian"), "1")
  await user.click(screen.getByRole("button", { name: "Preview" }))

  await waitFor(() => expect(screen.getByRole("columnheader", { name: "Payee/donor" })).toBeInTheDocument())
  expect(screen.queryByRole("columnheader", { name: "Payee/Donor" })).not.toBeInTheDocument()
})
