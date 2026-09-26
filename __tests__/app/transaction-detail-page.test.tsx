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
jest.mock("@/components/accounting/SendReceiptDialog", () => ({ SendReceiptDialog: jest.fn(() => null) }))
jest.mock("@/components/accounting/RiskFlagBadges", () => ({ RiskFlagBadges: () => null }))
jest.mock("@/components/accounting/TransactionAttachments", () => ({ TransactionAttachments: () => null }))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import TransactionDetailPage from "@/app/(dashboard)/accounting/transactions/[id]/page"
import { SendReceiptDialog } from "@/components/accounting/SendReceiptDialog"

const mockAuth = auth as jest.Mock
const mockFindUnique = prisma.transaction.findUnique as jest.Mock
const mockPersonFindUnique = prisma.person.findUnique as jest.Mock
const mockPersonFindFirst = prisma.person.findFirst as jest.Mock
const mockSendReceiptDialog = SendReceiptDialog as unknown as jest.Mock

const baseTx = {
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
  receiptSends: [],
  attachments: [],
}

const props = { params: Promise.resolve({ id: "5" }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
  mockFindUnique.mockResolvedValue(baseTx)
})

test("field-summary labels render as row headers, not plain cells", async () => {
  const html = renderToStaticMarkup(await TransactionDetailPage(props))

  expect(html).toMatch(/<th[^>]*scope="row"[^>]*>Date<\/th>/)
  expect(html).toMatch(/<th[^>]*scope="row"[^>]*>Description<\/th>/)
  expect(html).not.toMatch(/<td[^>]*>Date<\/td>/)
})

describe("receipt default email", () => {
  const dialogEmail = () => mockSendReceiptDialog.mock.calls[0][0].defaultEmail

  it("never loads an email for a read-only role", async () => {
    renderToStaticMarkup(await TransactionDetailPage(props))
    expect(mockPersonFindUnique).not.toHaveBeenCalled()
    expect(mockPersonFindFirst).not.toHaveBeenCalled()
    expect(mockSendReceiptDialog).not.toHaveBeenCalled()
  })

  it("prefers the transaction person's own email for an editor", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ ...baseTx, person: { id: 9, firstName: "A", lastName: "B" }, familyId: 3 })
    mockPersonFindUnique.mockResolvedValue({ email: "person@example.com" })
    renderToStaticMarkup(await TransactionDetailPage(props))
    expect(dialogEmail()).toBe("person@example.com")
    expect(mockPersonFindFirst).not.toHaveBeenCalled()
  })

  it("falls back to a family member's email when there is no person", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ ...baseTx, familyId: 3 })
    mockPersonFindFirst.mockResolvedValue({ email: "family@example.com" })
    renderToStaticMarkup(await TransactionDetailPage(props))
    expect(mockPersonFindUnique).not.toHaveBeenCalled()
    expect(dialogEmail()).toBe("family@example.com")
  })

  it("passes null when no email is on file", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockPersonFindFirst.mockResolvedValue(null)
    renderToStaticMarkup(await TransactionDetailPage(props))
    expect(dialogEmail()).toBeNull()
  })
})
