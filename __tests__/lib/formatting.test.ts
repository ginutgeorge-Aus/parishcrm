import { fmtAUD, parseISODate, MONTH_ABBR, MONTH_ABBR_TITLE, toCents, sumCents, centsToNumber, sessionDateFromTitle, maskEmail } from "@/lib/formatting"

describe("fmtAUD", () => {
  it("formats positives as AUD currency", () => {
    expect(fmtAUD(1234.5)).toBe("$1,234.50")
    expect(fmtAUD(0)).toBe("$0.00")
  })
  it("formats negatives with a leading minus", () => {
    expect(fmtAUD(-42)).toBe("-$42.00")
  })
})

describe("parseISODate", () => {
  it("parses a valid ISO date", () => {
    expect(parseISODate("2025-07-01")).toEqual(new Date("2025-07-01"))
  })
  it("rejects non-ISO and empty input", () => {
    expect(parseISODate("01/07/2025")).toBeNull()
    expect(parseISODate("")).toBeNull()
    expect(parseISODate(null)).toBeNull()
    expect(parseISODate(undefined)).toBeNull()
  })
  it("rejects ISO-shaped but invalid dates", () => {
    expect(parseISODate("2025-13-01")).toBeNull()
    expect(parseISODate("2025-00-10")).toBeNull()
    expect(parseISODate("2025-01-32")).toBeNull()
  })
  it("parses at UTC midnight, never shifted by local offset", () => {
    const d = parseISODate("2025-07-01")!
    expect(d.toISOString()).toBe("2025-07-01T00:00:00.000Z")
  })
})

describe("month abbreviation arrays", () => {
  it("MONTH_ABBR is uppercase", () => {
    expect(MONTH_ABBR[0]).toBe("JAN")
    expect(MONTH_ABBR).toHaveLength(12)
  })
  it("MONTH_ABBR_TITLE is title-case", () => {
    expect(MONTH_ABBR_TITLE[0]).toBe("Jan")
    expect(MONTH_ABBR_TITLE).toHaveLength(12)
  })
})

describe("sessionDateFromTitle", () => {
  it("parses a DD-MMM-YYYY title to a UTC-midnight Date", () => {
    expect(sessionDateFromTitle("31-AUG-2025")).toEqual(new Date("2025-08-31T00:00:00.000Z"))
    expect(sessionDateFromTitle("01-FEB-2026")).toEqual(new Date("2026-02-01T00:00:00.000Z"))
  })
  it("returns null for an unparseable title", () => {
    expect(sessionDateFromTitle("not a date")).toBeNull()
    expect(sessionDateFromTitle("31-XXX-2025")).toBeNull()
  })
})

describe("toCents", () => {
  const d = (s: string) => ({ toString: () => s })

  it("parses a Decimal-like value to integer cents", () => {
    expect(toCents(d("1234.56"))).toBe(123456)
    expect(toCents(d("100.00"))).toBe(10000)
    expect(toCents(d("0.05"))).toBe(5)
  })
  it("accepts plain numbers", () => {
    expect(toCents(100)).toBe(10000)
    expect(toCents(0.1)).toBe(10)
  })
  it("treats null/undefined as zero", () => {
    expect(toCents(null)).toBe(0)
    expect(toCents(undefined)).toBe(0)
  })
  it("handles negatives", () => {
    expect(toCents(d("-15.50"))).toBe(-1550)
  })
  it("pads a single-digit fractional part", () => {
    expect(toCents(d("3.5"))).toBe(350)
  })
  it("truncates IEEE-754 artefacts beyond two decimals", () => {
    // 0.1 + 0.2 === 0.30000000000000004
    expect(toCents(0.1 + 0.2)).toBe(30)
  })
})

describe("sumCents", () => {
  const d = (s: string) => ({ toString: () => s })

  it("returns 0 for an empty list", () => {
    expect(sumCents([])).toBe(0)
  })
  it("sums Decimal-like values exactly in integer cents", () => {
    // float: 0.1 + 0.2 + 0.3 !== 0.6 → cents avoids drift
    expect(sumCents([d("0.1"), d("0.2"), d("0.3")])).toBe(60)
  })
  it("sums a long list of cent values without drift", () => {
    const vals = new Array(100).fill(d("0.01"))
    expect(sumCents(vals)).toBe(100)
  })
})

describe("centsToNumber", () => {
  it("converts integer cents back to a dollar number", () => {
    expect(centsToNumber(123456)).toBe(1234.56)
    expect(centsToNumber(0)).toBe(0)
    expect(centsToNumber(-1550)).toBe(-15.5)
  })
})

describe("maskEmail", () => {
  it("keeps first local char + domain", () => {
    expect(maskEmail("jdoe@gmail.com")).toBe("j***@gmail.com")
  })
  it("single-char local part", () => {
    expect(maskEmail("a@x.com")).toBe("a***@x.com")
  })
  it("preserves domain case", () => {
    expect(maskEmail("Sam@Example.COM")).toBe("S***@Example.COM")
  })
  it("no @ or empty -> ***", () => {
    expect(maskEmail("notanemail")).toBe("***")
    expect(maskEmail("")).toBe("***")
  })
})
