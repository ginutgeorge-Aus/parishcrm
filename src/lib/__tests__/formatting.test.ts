import { maskEmail, safeDobDate, sessionDateFromTitle } from "@/lib/formatting"

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
  it.each(["2019-02-30", "2023-02-29", "2020-04-31", "2020-13-01"])("rejects the impossible date %s instead of rolling it over", (v) => {
    expect(safeDobDate(v)).toBeNull()
  })
  it("keeps the written calendar date when the value has a timezone offset", () => {
    expect(safeDobDate("2000-01-01T00:00:00+10:00")?.toISOString()).toBe("2000-01-01T00:00:00.000Z")
  })
  it("accepts a leap day", () => {
    expect(safeDobDate("2020-02-29")?.getUTCDate()).toBe(29)
  })
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

describe("safeDobDate (extra edges)", () => {
  it("accepts a leap day only in a leap year", () => {
    expect(safeDobDate("2024-02-29")?.toISOString()).toBe("2024-02-29T00:00:00.000Z")
    expect(safeDobDate("2025-02-29")).toBeNull()
  })
  it("returns midnight UTC for a plain date and for a timestamp's written date", () => {
    expect(safeDobDate("1990-05-15T13:45:00Z")?.toISOString()).toBe("1990-05-15T00:00:00.000Z")
  })
  it("falls back to native parsing for non-ISO-prefixed but parseable text", () => {
    // NOTE: no YYYY-MM-DD prefix, so the calendar roll-over check is skipped.
    expect(safeDobDate("May 15, 1990")).toBeInstanceOf(Date)
  })
})

describe("sessionDateFromTitle (extra edges)", () => {
  let errSpy: jest.SpyInstance
  beforeEach(() => {
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => errSpy.mockRestore())

  it("returns UTC midnight for a leap day", () => {
    expect(sessionDateFromTitle("29-FEB-2024")?.toISOString()).toBe("2024-02-29T00:00:00.000Z")
  })
  it.each(["", "1-AUG-2025", "31-Aug-2025", "31-aug-2025", "31-AUG-25", " 31-AUG-2025", "31-AUG-2025 "])(
    "returns null and logs for malformed title %j",
    (t) => {
      expect(sessionDateFromTitle(t)).toBeNull()
      expect(errSpy).toHaveBeenCalledTimes(1)
    },
  )
  it("does not log on a valid title", () => {
    sessionDateFromTitle("31-AUG-2025")
    expect(errSpy).not.toHaveBeenCalled()
  })
  it("rolls an impossible day over rather than rejecting it", () => {
    // NOTE: "31-FEB-2025" is not a real date but the helper does not validate the day;
    // it normalises to 2025-03-03. Titles come from pettyCashTitle so this is latent.
    expect(sessionDateFromTitle("31-FEB-2025")?.toISOString()).toBe("2025-03-03T00:00:00.000Z")
  })
})

describe("maskEmail (extra edges)", () => {
  it("fully redacts empty, no-@ and leading-@ values", () => {
    expect(maskEmail("")).toBe("***")
    expect(maskEmail("no-at-sign")).toBe("***")
    expect(maskEmail("@x.com")).toBe("***")
  })
  it("keeps everything from the first @ onward", () => {
    expect(maskEmail("a@b@c.com")).toBe("a***@b@c.com")
  })
  it("never leaks the rest of the local part", () => {
    expect(maskEmail("secretname@example.com")).not.toContain("ecretname")
  })
})
