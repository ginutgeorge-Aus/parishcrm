import { safeDobDate } from "@/lib/formatting"

describe("fmtAUD / fmtAUDAccounting currency config", () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    jest.resetModules()
  })
  const load = (env: Record<string, string | undefined>) => {
    process.env = { ...ORIGINAL, ...env }
    jest.resetModules()
    return require("@/lib/formatting")
  }

  it("defaults to AUD/en-AU (byte-identical to today)", () => {
    const { fmtAUD, fmtAUDAccounting } = load({})
    expect(fmtAUD(1234.56)).toBe("$1,234.56")
    expect(fmtAUDAccounting(1234.56)).toBe("$1,234.56")
    expect(fmtAUDAccounting(-1234.56)).toBe("($1,234.56)")
    expect(fmtAUDAccounting(0)).toBe("$0.00")
    expect(fmtAUDAccounting(-0)).toBe("$0.00")
  })

  it("honours USD/en-US override", () => {
    const { fmtAUD, fmtAUDAccounting } = load({
      APP_CURRENCY: "USD",
      APP_LOCALE: "en-US",
    })
    expect(fmtAUD(1234.56)).toBe("$1,234.56")
    expect(fmtAUDAccounting(-1234.56)).toBe("($1,234.56)")
  })

  it("honours EUR/de-DE override (symbol + grouping follow locale)", () => {
    const { fmtAUD } = load({
      APP_CURRENCY: "EUR",
      APP_LOCALE: "de-DE",
    })
    // de-DE EUR formats as "1.234,56 €"
    expect(fmtAUD(1234.56)).toContain("€")
  })
})

describe("safeDobDate", () => {
  it("parses a valid ISO date string", () => {
    const d = safeDobDate("1990-05-15")
    expect(d).toBeInstanceOf(Date)
    expect(d?.getUTCFullYear()).toBe(1990)
  })

  it("returns null for null / undefined / empty", () => {
    expect(safeDobDate(null)).toBeNull()
    expect(safeDobDate(undefined)).toBeNull()
    expect(safeDobDate("")).toBeNull()
  })

  it("returns null for a decryption-failure fallback string", () => {
    // safeDecrypt yields non-date text on a bad/rotated-away ciphertext; the
    // read paths must not surface an Invalid Date.
    expect(safeDobDate("[decryption error]")).toBeNull()
  })

  it("returns null for an impossible date", () => {
    expect(safeDobDate("2020-13-45")).toBeNull()
    expect(safeDobDate("not-a-date")).toBeNull()
  })
})
