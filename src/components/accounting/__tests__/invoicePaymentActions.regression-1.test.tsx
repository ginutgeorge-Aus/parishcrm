// Regression: ISSUE-001 — link candidates showed a Decimal string ("$275.5") instead of currency
// Found by /qa on 2026-10-13
// Report: .gstack/qa-reports/qa-report-localhost-2026-10-13.md
import { render, screen, fireEvent } from "@testing-library/react"
import { InvoicePaymentActions } from "@/components/accounting/InvoicePaymentActions"
import { listPaymentCandidates } from "@/lib/actions/invoicePayment"

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock("@/lib/actions/invoicePayment", () => ({ markInvoicePaid: jest.fn(), unmarkInvoicePaid: jest.fn(), listPaymentCandidates: jest.fn() }))
jest.mock("@/lib/dates", () => ({ sydneyTodayYMD: () => "2026-10-20" }))

it.each([["275.5", "$275.50"], ["1234", "$1,234.00"]])("formats a candidate amount of %s as %s", async (amount, shown) => {
  ;(listPaymentCandidates as jest.Mock).mockResolvedValue([{ id: 50, date: "2026-10-18", amount, reference: null, paymentAccountName: "Main", accountName: "Donations" }])
  render(<InvoicePaymentActions id={11} status="SENT" bankAccounts={[{ id: 2, name: "Main" }]} hasEmail={false} />)
  fireEvent.click(screen.getByRole("button", { name: "Mark paid" }))
  expect(await screen.findByLabelText(`2026-10-18 · ${shown} · Main · Donations`)).toBeTruthy()
})
