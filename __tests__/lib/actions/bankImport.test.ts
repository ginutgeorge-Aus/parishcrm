// __tests__/lib/actions/bankImport.test.ts
/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { rememberBankImportAccount } from "@/lib/actions/bankImport"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
    paymentAccount: { findFirst: jest.fn() },
  },
}))

describe("rememberBankImportAccount", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue({ id: 3 })
    ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ value: '{"1111":2}' })
  })

  it("rejects roles without accounting access", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    await expect(rememberBankImportAccount("000111224821", 3)).resolves.toEqual({ error: "Unauthorized" })
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it("rejects a non-BANK or inactive account", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue(null)
    await expect(rememberBankImportAccount("000111224821", 3)).resolves.toEqual({ error: "Invalid bank account" })
  })

  it("rejects an account number without 4 digits", async () => {
    await expect(rememberBankImportAccount("12", 3)).resolves.toEqual({ error: "Invalid account number" })
  })

  it("merges the last-4 mapping into the stored map", async () => {
    await expect(rememberBankImportAccount("000111224821", 3)).resolves.toEqual({ success: true })
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "bankImport.accountMap" },
      create: { key: "bankImport.accountMap", value: '{"1111":2,"4821":3}' },
      update: { value: '{"1111":2,"4821":3}' },
    })
  })
})
