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
jest.mock("@/components/accounting/OpeningBalanceForm", () => ({ OpeningBalanceForm: () => null }))
jest.mock("@/components/accounting/PettyCashCustodianForm", () => ({ PettyCashCustodianForm: () => null }))
jest.mock("@/components/accounting/PeriodLockForm", () => ({ PeriodLockForm: () => null }))
jest.mock("@/components/accounting/PaymentAccountsManager", () => ({ PaymentAccountsManager: () => null }))
jest.mock("@/components/accounting/InvoiceSettingsForm", () => ({ InvoiceSettingsForm: () => null }))

import AccountingSettingsPage from "@/app/(dashboard)/accounting/settings/page"
import { auth } from "@/auth"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { resolveFeatures } from "@/lib/features"

it("uses sentence case for the Manage funds button", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(getEnabledFeatures as jest.Mock).mockResolvedValue(resolveFeatures({}))
  const html = renderToStaticMarkup(await AccountingSettingsPage())
  expect(html).toContain("Manage funds")
  expect(html).not.toContain("Manage Funds")
  expect(html).not.toContain("Accounting Settings")
})
