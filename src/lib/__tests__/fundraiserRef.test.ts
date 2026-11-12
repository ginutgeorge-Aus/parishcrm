import { makeBankRef } from "@/lib/fundraiserRef"

describe("makeBankRef", () => {
  it("defaults to FR with 4-digit padding", () => {
    expect(makeBankRef(null, 7)).toBe("FR0007")
  })
  it("sanitises the prefix", () => {
    expect(makeBankRef("pothi choru", 7)).toBe("POTHICHORU0007")
  })
  it("falls back to FR when the sanitised prefix is empty", () => {
    expect(makeBankRef("!!! ---", 12)).toBe("FR0012")
    expect(makeBankRef("", 12)).toBe("FR0012")
  })
  it("caps at 18 chars by truncating the prefix, keeping the full seq", () => {
    const ref = makeBankRef("abcdefghijklmnopqrstuvwxyz", 7)
    expect(ref).toBe("ABCDEFGHIJKLMN0007")
    expect(ref).toHaveLength(18)
  })
  it("does not truncate a seq wider than 4 digits", () => {
    expect(makeBankRef("abcdefghijklmnopqrstuvwxyz", 123456)).toBe("ABCDEFGHIJKL123456")
    expect(makeBankRef(null, 12345)).toBe("FR12345")
  })
})
