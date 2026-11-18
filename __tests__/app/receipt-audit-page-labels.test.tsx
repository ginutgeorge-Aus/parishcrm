jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => "1") }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { receiptSend: { findMany: jest.fn(), count: jest.fn() } },
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))

import { render, screen } from "@testing-library/react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import ReceiptAuditPage from "@/app/(dashboard)/accounting/receipt-audit/page"

const sendRow = () => ({
      id: 1,
      sentTo: "donor@example.com",
      sentAt: new Date("2026-07-02T01:00:00Z"),
      status: "SUCCESS",
      errorMessage: null,
      sentBy: { name: "Test Admin" },
      transaction: {
        id: 5,
        description: "Tithe July",
        amount: { toString: () => "50" },
        account: { code: "100", name: "Tithe" },
      },
    })

function seed(role: string) {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role, id: "1" } })
  ;(prisma.receiptSend.findMany as jest.Mock).mockResolvedValue([sendRow()])
  ;(prisma.receiptSend.count as jest.Mock).mockResolvedValue(1)
}

test("receipt log table uses sentence-case column headers", async () => {
  seed("ADMIN")

  render(await ReceiptAuditPage({ searchParams: Promise.resolve({}) }))

  for (const name of ["Sent at", "Sent to", "Transaction", "Amount", "Account", "Sent by", "Status", "Error"]) {
    expect(screen.getByRole("columnheader", { name })).toBeInTheDocument()
  }
  expect(screen.getAllByText("donor@example.com").length).toBeGreaterThan(0)
})

test("AUDITOR never sees the address a receipt was sent to", async () => {
  seed("AUDITOR")
  render(await ReceiptAuditPage({ searchParams: Promise.resolve({}) }))
  expect(screen.queryByText("donor@example.com")).not.toBeInTheDocument()
  expect(screen.getAllByText("Hidden").length).toBeGreaterThan(0)
})
