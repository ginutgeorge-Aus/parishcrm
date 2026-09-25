/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    pettyCashExpense: { findUnique: jest.fn() },
    account: { findMany: jest.fn() },
    fund: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v),
}))
jest.mock("@/lib/actions/pettyCashExpense", () => ({
  updateExpense: jest.fn(),
}))
jest.mock("@/components/petty-cash/ExpenseForm", () => ({
  ExpenseForm: () => null,
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { redirect, notFound } from "next/navigation"
import EditExpensePage from "@/app/(dashboard)/accounting/petty-cash/sessions/[id]/expenses/[expenseId]/edit/page"

const mockAuth = auth as jest.Mock
const mockExpenseFindUnique = prisma.pettyCashExpense.findUnique as jest.Mock
const mockAccountFindMany = prisma.account.findMany as jest.Mock
const mockSafeDecrypt = safeDecrypt as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock
const mockNotFound = notFound as unknown as jest.Mock

const makeProps = (id = "1", expenseId = "10") => ({
  params: Promise.resolve({ id, expenseId }),
})

const makeExpense = (overrides?: object) => ({
  id: 10,
  sessionId: 1,
  amount: { toString: () => "25.50" },
  payee: "enc:v1:payee-ciphertext",
  description: "enc:v1:desc-ciphertext",
  accountId: 5,
  receiptRef: "REC-001",
  session: { id: 1, title: "01-JUN-2026", status: "OPEN" },
  ...overrides,
})

const makeAccounts = () => [
  { id: 5, code: "6100", name: "Stationery" },
]

beforeEach(() => jest.clearAllMocks())

describe("EditExpensePage", () => {
  describe("role guard", () => {
    it("redirects VIEWER to /accounting/petty-cash", async () => {
      mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
      await expect(EditExpensePage(makeProps())).rejects.toThrow("REDIRECT")
      expect(mockRedirect).toHaveBeenCalledWith("/accounting/petty-cash")
    })

    it("redirects AUDITOR to /accounting/petty-cash", async () => {
      mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
      await expect(EditExpensePage(makeProps())).rejects.toThrow("REDIRECT")
      expect(mockRedirect).toHaveBeenCalledWith("/accounting/petty-cash")
    })
  })

  describe("notFound guard", () => {
    it("calls notFound for non-numeric id", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      await expect(EditExpensePage(makeProps("abc", "10"))).rejects.toThrow("NOT_FOUND")
      expect(mockNotFound).toHaveBeenCalled()
    })

    it("calls notFound for zero expenseId", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      await expect(EditExpensePage(makeProps("1", "0"))).rejects.toThrow("NOT_FOUND")
      expect(mockNotFound).toHaveBeenCalled()
    })

    it("calls notFound when expense not found", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      mockExpenseFindUnique.mockResolvedValue(null)
      await expect(EditExpensePage(makeProps())).rejects.toThrow("NOT_FOUND")
    })

    it("calls notFound when expense belongs to different session (IDOR guard)", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      // expense.sessionId = 99, but URL id = 1
      mockExpenseFindUnique.mockResolvedValue(makeExpense({ sessionId: 99 }))
      await expect(EditExpensePage(makeProps("1", "10"))).rejects.toThrow("NOT_FOUND")
    })
  })

  describe("closed session guard", () => {
    it("redirects to session page when session is CLOSED", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      mockExpenseFindUnique.mockResolvedValue(
        makeExpense({ session: { id: 1, title: "01-JUN-2026", status: "CLOSED" } })
      )
      await expect(EditExpensePage(makeProps("1", "10"))).rejects.toThrow("REDIRECT")
      expect(mockRedirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
    })
  })

  describe("happy path — decrypt succeeds", () => {
    it("renders without throwing for ADMIN with valid expense", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      mockExpenseFindUnique.mockResolvedValue(makeExpense())
      mockAccountFindMany.mockResolvedValue(makeAccounts())
      mockSafeDecrypt.mockImplementation((v: string) => v.replace(/^enc:v1:/, "decrypted-"))

      const result = await EditExpensePage(makeProps())
      expect(result).toBeDefined()
      expect(mockRedirect).not.toHaveBeenCalled()
      expect(mockNotFound).not.toHaveBeenCalled()
    })

    it("renders without throwing for PASTOR with valid expense", async () => {
      mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
      mockExpenseFindUnique.mockResolvedValue(makeExpense())
      mockAccountFindMany.mockResolvedValue(makeAccounts())

      const result = await EditExpensePage(makeProps())
      expect(result).toBeDefined()
    })

    it("passes decrypted payee and description to form", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      mockExpenseFindUnique.mockResolvedValue(makeExpense())
      mockAccountFindMany.mockResolvedValue(makeAccounts())
      mockSafeDecrypt
        .mockReturnValueOnce("Joe's Cafe")       // payee
        .mockReturnValueOnce("Coffee supplies")   // description

      await EditExpensePage(makeProps())
      expect(mockSafeDecrypt).toHaveBeenCalledWith("enc:v1:payee-ciphertext")
      expect(mockSafeDecrypt).toHaveBeenCalledWith("enc:v1:desc-ciphertext")
    })
  })

  describe("decrypt-throws path", () => {
    it("renders without throwing when payee ciphertext is corrupt", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      mockExpenseFindUnique.mockResolvedValue(
        makeExpense({ payee: "enc:v1:CORRUPT", description: "enc:v1:valid-desc" })
      )
      mockAccountFindMany.mockResolvedValue(makeAccounts())
      // safeDecrypt returns placeholder instead of throwing for corrupt value
      mockSafeDecrypt.mockImplementation((v: string) =>
        v.includes("CORRUPT") ? "[decryption error]" : "Normal description"
      )

      const result = await EditExpensePage(makeProps())
      expect(result).toBeDefined()
      expect(mockSafeDecrypt).toHaveBeenCalledWith("enc:v1:CORRUPT")
    })

    it("renders without throwing when description ciphertext is corrupt", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      mockExpenseFindUnique.mockResolvedValue(
        makeExpense({ payee: "enc:v1:valid-payee", description: "enc:v1:CORRUPT" })
      )
      mockAccountFindMany.mockResolvedValue(makeAccounts())
      mockSafeDecrypt.mockImplementation((v: string) =>
        v.includes("CORRUPT") ? "[decryption error]" : "Normal payee"
      )

      const result = await EditExpensePage(makeProps())
      expect(result).toBeDefined()
      expect(mockSafeDecrypt).toHaveBeenCalledWith("enc:v1:CORRUPT")
    })

    it("returns placeholder string [decryption error] for both corrupt fields", async () => {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      mockExpenseFindUnique.mockResolvedValue(
        makeExpense({ payee: "enc:v1:BAD1", description: "enc:v1:BAD2" })
      )
      mockAccountFindMany.mockResolvedValue(makeAccounts())
      mockSafeDecrypt.mockReturnValue("[decryption error]")

      // page must NOT throw — safeDecrypt degrades gracefully, no 500
      const result = await EditExpensePage(makeProps())
      expect(result).toBeDefined()
      expect(mockSafeDecrypt).toHaveBeenCalledTimes(2)
    })
  })
})
