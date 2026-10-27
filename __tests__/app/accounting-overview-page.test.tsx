/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { aggregate: jest.fn(), count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
    account: { count: jest.fn() },
  },
}))
jest.mock("@/lib/paymentAccounts", () => ({ getPaymentAccounts: jest.fn() }))
jest.mock("@/components/accounting/BalanceTile", () => ({ BalanceTile: () => null }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getPaymentAccounts } from "@/lib/paymentAccounts"
import AccountingPage from "@/app/(dashboard)/accounting/page"

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: { toString: () => "100" } } })
  ;(prisma.transaction.count as jest.Mock).mockResolvedValue(2)
  ;(prisma.account.count as jest.Mock).mockResolvedValue(3)
  ;(prisma.transaction.groupBy as jest.Mock).mockResolvedValue([])
  ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
  ;(getPaymentAccounts as jest.Mock).mockResolvedValue([])
})

test("renders the FY stat cards as h3 headings", async () => {
  const html = renderToStaticMarkup(await AccountingPage())
  expect(html).toMatch(/<h3[^>]*>FY \d{4}–\d{4} Income<\/h3>/)
  expect(html).toMatch(/<h3[^>]*>Transactions \(FY\)<\/h3>/)
  expect(html).toContain("No transactions yet.")
})

test("redirects roles that cannot view accounting", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
  await expect(AccountingPage()).rejects.toThrow("REDIRECT:/")
})
