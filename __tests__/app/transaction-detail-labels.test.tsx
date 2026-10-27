/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => "1") }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findUnique: jest.fn() },
    person: { findUnique: jest.fn(), findFirst: jest.fn() },
  },
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))
jest.mock("@/components/accounting/SendReceiptDialog", () => ({ SendReceiptDialog: () => null }))
jest.mock("@/components/accounting/RiskFlagBadges", () => ({ RiskFlagBadges: () => null }))
jest.mock("@/components/accounting/TransactionAttachments", () => ({ TransactionAttachments: () => null }))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import TransactionDetailPage from "@/app/(dashboard)/accounting/transactions/[id]/page"

test("receipt history table uses sentence-case column headers", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
  ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
    id: 5,
    date: new Date("2026-07-01"),
    description: "Tithe July",
    notes: null,
    amount: { toString: () => "50" },
    type: "INCOME",
    paymentAccount: null,
    reference: null,
    family: null,
    person: null,
    familyId: null,
    account: { code: "100", name: "Tithe" },
    attachments: [],
    receiptSends: [
      {
        id: 1,
        sentTo: "donor@example.com",
        sentAt: new Date("2026-07-02T01:00:00Z"),
        sentBy: { name: "Test Admin" },
        status: "FAILED",
        errorMessage: "Mailbox full",
      },
    ],
  })
  const html = renderToStaticMarkup(await TransactionDetailPage({ params: Promise.resolve({ id: "5" }) }))
  for (const h of ["Sent to", "Sent at", "Sent by", "Status", "Error"]) {
    expect(html).toContain(`>${h}</th>`)
  }
  expect(html).not.toContain(">Sent To<")
  expect(html).toContain("donor@example.com")
  expect(html).toContain("Mailbox full")
})
