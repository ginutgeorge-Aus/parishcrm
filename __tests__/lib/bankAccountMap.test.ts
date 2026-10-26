// __tests__/lib/bankAccountMap.test.ts
/** @jest-environment node */
import { accountSuffix, parseAccountMap, suggestPaymentAccountId, BANK_ACCOUNT_MAP_KEY } from "@/lib/bankAccountMap"
import { prisma } from "@/lib/prisma"

jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findUnique: jest.fn() }, paymentAccount: { findFirst: jest.fn() } },
}))

describe("accountSuffix", () => {
  it("returns the last 4 digits", () => {
    expect(accountSuffix("0123-4567 4821")).toBe("4821")
  })
  it("returns null when fewer than 4 digits", () => {
    expect(accountSuffix("")).toBeNull()
    expect(accountSuffix("12a")).toBeNull()
  })
})

describe("parseAccountMap", () => {
  it("keeps only 4-digit keys with positive int values", () => {
    expect(parseAccountMap('{"4821":3,"12":4,"9999":-1,"1111":"x"}')).toEqual({ "4821": 3 })
  })
  it("returns {} for null or corrupt JSON", () => {
    expect(parseAccountMap(null)).toEqual({})
    expect(parseAccountMap("{nope")).toEqual({})
    expect(parseAccountMap("[1]")).toEqual({})
  })
})

describe("suggestPaymentAccountId", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns the mapped id when the account is an active BANK", async () => {
    ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ key: BANK_ACCOUNT_MAP_KEY, value: '{"4821":3}' })
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue({ id: 3 })
    await expect(suggestPaymentAccountId("000111224821")).resolves.toBe(3)
    expect(prisma.paymentAccount.findFirst).toHaveBeenCalledWith({ where: { id: 3, kind: "BANK", isActive: true }, select: { id: true } })
  })
  it("returns null for stale ids, unmapped suffixes, or no account number", async () => {
    ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ value: '{"4821":3}' })
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue(null)
    await expect(suggestPaymentAccountId("4821")).resolves.toBeNull()
    await expect(suggestPaymentAccountId("5555")).resolves.toBeNull()
    await expect(suggestPaymentAccountId("")).resolves.toBeNull()
  })
})
