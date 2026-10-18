import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
jest.mock("next/link", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: { findMany: jest.fn().mockResolvedValue([]) },
    person: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/actions/settings", () => ({ getPettyCashDefaultCustodianId: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/accountingLock", () => ({ getAccountingLockDate: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/paymentAccounts", () => ({ getPaymentAccounts: jest.fn().mockResolvedValue([]) }))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn().mockResolvedValue({}) }))
jest.mock("@/components/ui/button", () => ({ Button: ({ children }: { children: React.ReactNode }) => children }))

/** Stub a client component as a named marker. */
function mockStub(name: string) {
  return { [name]: () => <i data-c={name} /> }
}
jest.mock("@/components/accounting/OpeningBalanceForm", () => mockStub("OpeningBalanceForm"))
jest.mock("@/components/accounting/PettyCashCustodianForm", () => mockStub("PettyCashCustodianForm"))
jest.mock("@/components/accounting/PeriodLockForm", () => mockStub("PeriodLockForm"))
jest.mock("@/components/accounting/PaymentAccountsManager", () => mockStub("PaymentAccountsManager"))
jest.mock("@/components/accounting/InvoiceSettingsForm", () => mockStub("InvoiceSettingsForm"))

import AccountingSettingsPage from "@/app/(dashboard)/accounting/settings/page"
import { auth } from "@/auth"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { resolveFeatures } from "@/lib/features"

/** Render as ADMIN with the given overrides applied. */
async function renderWith(overrides: Record<string, boolean>) {
  ;(getEnabledFeatures as jest.Mock).mockResolvedValue(resolveFeatures(overrides))
  return renderToStaticMarkup(await AccountingSettingsPage())
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
})

it("shows the petty cash and invoice settings while both features are on", async () => {
  const html = await renderWith({ pettyCash: true, invoices: true })
  expect(html).toContain('data-c="PettyCashCustodianForm"')
  expect(html).toContain('data-c="InvoiceSettingsForm"')
})

it("hides the petty cash custodian while Petty cash is off", async () => {
  const html = await renderWith({ pettyCash: false, invoices: true })
  expect(html).not.toContain('data-c="PettyCashCustodianForm"')
  expect(html).not.toContain("Petty Cash Auto-open")
  expect(html).toContain('data-c="InvoiceSettingsForm"')
})

it("hides the invoice settings while Invoices is off", async () => {
  const html = await renderWith({ pettyCash: true, invoices: false })
  expect(html).not.toContain('data-c="InvoiceSettingsForm"')
  expect(html).toContain('data-c="PettyCashCustodianForm"')
  expect(html).toContain('data-c="PeriodLockForm"')
})
