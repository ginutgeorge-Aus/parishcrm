import { getPaymentAccounts, getCashAccount } from "@/lib/paymentAccounts"

jest.mock("@/lib/prisma", () => ({
  prisma: {
    paymentAccount: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}))
import { prisma } from "@/lib/prisma"

beforeEach(() => jest.clearAllMocks())

describe("getPaymentAccounts", () => {
  it("filters by kind + active and orders default-first", async () => {
    ;(prisma.paymentAccount.findMany as jest.Mock).mockResolvedValue([])
    await getPaymentAccounts({ kind: "BANK", activeOnly: true })
    expect(prisma.paymentAccount.findMany).toHaveBeenCalledWith({
      where: { kind: "BANK", isActive: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true, isDefault: true, isActive: true },
    })
  })
})

describe("getCashAccount", () => {
  it("returns the single active cash account", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue({ id: 3, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true })
    const cash = await getCashAccount()
    expect(cash?.id).toBe(3)
    expect(prisma.paymentAccount.findFirst).toHaveBeenCalledWith({
      where: { kind: "CASH", isActive: true },
      select: { id: true, name: true, kind: true, isDefault: true, isActive: true },
    })
    expect(prisma.paymentAccount.upsert).not.toHaveBeenCalled()
  })

  it("self-heals a missing cash account by creating the canonical Petty Cash", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.paymentAccount.upsert as jest.Mock).mockResolvedValue({
      id: 9,
      name: "Petty Cash",
      kind: "CASH",
      isDefault: false,
      isActive: true,
    })
    const cash = await getCashAccount()
    expect(cash.id).toBe(9)
    expect(prisma.paymentAccount.upsert).toHaveBeenCalledWith({
      where: { name: "Petty Cash" },
      update: {},
      create: { name: "Petty Cash", kind: "CASH", isActive: true },
      select: { id: true, name: true, kind: true, isDefault: true, isActive: true },
    })
    expect(prisma.paymentAccount.update).not.toHaveBeenCalled()
    expect(prisma.paymentAccount.create).not.toHaveBeenCalled()
  })

  it("reactivates a dormant CASH namesake instead of leaving it inactive", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.paymentAccount.upsert as jest.Mock).mockResolvedValue({ id: 7, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: false })
    ;(prisma.paymentAccount.update as jest.Mock).mockResolvedValue({ id: 7, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true })
    const cash = await getCashAccount()
    expect(cash.id).toBe(7)
    expect(cash.isActive).toBe(true)
    expect(prisma.paymentAccount.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { isActive: true },
      select: { id: true, name: true, kind: true, isDefault: true, isActive: true },
    })
    expect(prisma.paymentAccount.create).not.toHaveBeenCalled()
  })

  it("never adopts a non-CASH namesake — creates a distinct cash account instead", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue(null)
    // A BANK account happens to be named "Petty Cash"; upsert returns it.
    ;(prisma.paymentAccount.upsert as jest.Mock).mockResolvedValue({ id: 4, name: "Petty Cash", kind: "BANK", isDefault: false, isActive: true })
    ;(prisma.paymentAccount.create as jest.Mock).mockResolvedValue({ id: 8, name: "Cash", kind: "CASH", isDefault: false, isActive: true })
    const cash = await getCashAccount()
    expect(cash.id).toBe(8)
    expect(cash.kind).toBe("CASH")
    expect(prisma.paymentAccount.create).toHaveBeenCalledWith({
      data: { name: "Cash", kind: "CASH", isActive: true },
      select: { id: true, name: true, kind: true, isDefault: true, isActive: true },
    })
  })

  it("probes the next name when the 'Cash' fallback also collides", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // no active cash account
      .mockResolvedValueOnce(null) // after "Cash" P2002: still none (namesake is non-CASH)
    ;(prisma.paymentAccount.upsert as jest.Mock).mockResolvedValue({ id: 4, name: "Petty Cash", kind: "BANK", isDefault: false, isActive: true })
    ;(prisma.paymentAccount.create as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" })) // "Cash" taken by a bank namesake
      .mockResolvedValueOnce({ id: 9, name: "Cash 2", kind: "CASH", isDefault: false, isActive: true })
    const cash = await getCashAccount()
    expect(cash.id).toBe(9)
    expect(prisma.paymentAccount.create).toHaveBeenNthCalledWith(2, {
      data: { name: "Cash 2", kind: "CASH", isActive: true },
      select: { id: true, name: true, kind: true, isDefault: true, isActive: true },
    })
  })

  it("adopts the winner of a concurrent create on P2002 instead of erroring", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // no active cash account at entry
      .mockResolvedValueOnce({ id: 5, name: "Cash", kind: "CASH", isDefault: false, isActive: true }) // concurrent winner
    ;(prisma.paymentAccount.upsert as jest.Mock).mockResolvedValue({ id: 4, name: "Petty Cash", kind: "BANK", isDefault: false, isActive: true })
    ;(prisma.paymentAccount.create as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
    const cash = await getCashAccount()
    expect(cash.id).toBe(5)
    expect(prisma.paymentAccount.create).toHaveBeenCalledTimes(1)
  })

  it("adopts a concurrent active-CASH winner when the canonical upsert loses the one-active-cash race", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // none at entry
      .mockResolvedValueOnce({ id: 6, name: "Vestry Cash", kind: "CASH", isDefault: false, isActive: true }) // race winner
    // Another name became the active CASH account after our findFirst, so
    // creating "Petty Cash" violates the one-active-cash index.
    ;(prisma.paymentAccount.upsert as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
    const cash = await getCashAccount()
    expect(cash.id).toBe(6)
    expect(prisma.paymentAccount.create).not.toHaveBeenCalled()
  })

  it("adopts a concurrent active-CASH winner when reactivating a dormant namesake loses the race", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // none at entry
      .mockResolvedValueOnce({ id: 7, name: "Vestry Cash", kind: "CASH", isDefault: false, isActive: true }) // race winner
    ;(prisma.paymentAccount.upsert as jest.Mock).mockResolvedValue({ id: 8, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: false })
    // Reactivating the dormant namesake collides with a now-active CASH account.
    ;(prisma.paymentAccount.update as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
    const cash = await getCashAccount()
    expect(cash.id).toBe(7)
  })
})
