/** @jest-environment node */
// #514 / #511: the keyed digest is derived only when a rewrite happens, and the
// legacy dedup form is controlled by one switch.
const mockHmac = jest.fn((_acct: string) => "ab".repeat(32))
jest.mock("@/lib/cryptoCore", () => ({ ...jest.requireActual("@/lib/cryptoCore"), hmacBankRefAccount: (a: string) => mockHmac(a) }))

import { BankRefHashError, LEGACY_BANKREF_DEDUP, createBankRefHasher, dedupForms } from "@/lib/bankRefHash"

const ACCT = "987654321"

beforeEach(() => {
  mockHmac.mockReset()
  mockHmac.mockImplementation(() => "ab".repeat(32))
})

describe("lazy digest (#514)", () => {
  it("does not derive the key for refs/keys that do not carry the account", () => {
    mockHmac.mockImplementation(() => {
      throw new Error("no v1 key")
    })
    const h = createBankRefHasher()
    expect(h.ref("ANZ_111_20250623_60.00_X_1", ACCT)).toBe("ANZ_111_20250623_60.00_X_1")
    expect(h.key("111_20250623_60.00_X", ACCT)).toBe("111_20250623_60.00_X")
    expect(h.stored("QIF_PA3_20260905_10.00_SHOP_1")).toBe("QIF_PA3_20260905_10.00_SHOP_1")
    expect(h.stored("PC_R_12")).toBe("PC_R_12")
    expect(mockHmac).not.toHaveBeenCalled()
    // ...but a ref that would be rewritten still fails closed.
    expect(() => h.ref(`ANZ_${ACCT}_20250623_60.00_X_1`, ACCT)).toThrow(BankRefHashError)
  })

  it("derives the digest once per account across refs", () => {
    const h = createBankRefHasher()
    h.ref(`ANZ_${ACCT}_20250623_60.00_X_1`, ACCT)
    h.stored(`ANZ_${ACCT}_20250623_70.00_Y_2`)
    expect(mockHmac).toHaveBeenCalledTimes(1)
  })
})

describe("legacy dedup switch (#511)", () => {
  it("is on by default: hashed form first, then legacy", () => {
    expect(LEGACY_BANKREF_DEDUP).toBe(true)
    expect(dedupForms("legacy", "hashed")).toEqual(["hashed", "legacy"])
  })

  it("collapses to the hashed form when legacy is off or nothing changed", () => {
    expect(dedupForms("legacy", "hashed", false)).toEqual(["hashed"])
    expect(dedupForms("same", "same")).toEqual(["same"])
  })
})
