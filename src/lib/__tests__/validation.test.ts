import {
  MONEY_DECIMAL_RE,
  SIGNED_MONEY_DECIMAL_RE,
  hasEncryptedFieldMatch,
  isRealCalendarDate,
  isTwoDecimalMoney,
  isValidEmail,
  parseOptimisticUpdatedAt,
} from "@/lib/validation"

describe("MONEY_DECIMAL_RE", () => {
  it.each(["0", "5", "12.3", "12.34", "0.00", "1000000", "007.50"])("accepts %s", (v) => {
    expect(MONEY_DECIMAL_RE.test(v)).toBe(true)
  })
  it.each(["", "1.005", "1.", ".5", "-1", "-0", "+1", "1,000.00", "1e3", " 1", "1 ", "abc", "1.2.3"])(
    "rejects %j",
    (v) => {
      expect(MONEY_DECIMAL_RE.test(v)).toBe(false)
    },
  )
})

describe("SIGNED_MONEY_DECIMAL_RE", () => {
  it.each(["0", "-5", "-12.3", "-0.00", "-0", "12.34"])("accepts %s", (v) => {
    expect(SIGNED_MONEY_DECIMAL_RE.test(v)).toBe(true)
  })
  it.each(["", "-", "--1", "1.005", "-1.005", "+1", "-.5", "1-", "- 1"])("rejects %j", (v) => {
    expect(SIGNED_MONEY_DECIMAL_RE.test(v)).toBe(false)
  })
})

describe("isTwoDecimalMoney", () => {
  it.each([0, 1, 1.5, 1.25, 100.1, 0.01, -0, -2.5, 1234567.89])("accepts %p", (n) => {
    expect(isTwoDecimalMoney(n)).toBe(true)
  })
  it.each([1.005, 0.001, 1.234, 10.999])("rejects sub-cent amount %p", (n) => {
    expect(isTwoDecimalMoney(n)).toBe(false)
  })
  it.each([NaN, Infinity, -Infinity])("rejects non-finite %p", (n) => {
    expect(isTwoDecimalMoney(n)).toBe(false)
  })
})

describe("isRealCalendarDate", () => {
  it.each(["2024-02-29", "2000-02-29", "2025-12-31", "2025-01-01", "2025-04-30"])("accepts %s", (v) => {
    expect(isRealCalendarDate(v)).toBe(true)
  })
  it.each(["2025-02-29", "1900-02-29", "2025-02-30", "2025-04-31", "2025-13-01", "2025-00-10", "2025-01-00", "2025-01-32"])(
    "rejects impossible date %s",
    (v) => {
      expect(isRealCalendarDate(v)).toBe(false)
    },
  )
  it.each(["", "2025-2-1", "25-02-01", "2025/02/01", "2025-02-01T00:00:00Z", " 2025-02-01", "2025-02-01\n", "abcd-ef-gh"])(
    "rejects malformed string %j",
    (v) => {
      expect(isRealCalendarDate(v)).toBe(false)
    },
  )
})

describe("parseOptimisticUpdatedAt", () => {
  /** Build a FormData holding the given `updatedAt` entry (or none when undefined). */
  const fd = (v?: string | Blob) => {
    const f = new FormData()
    if (v !== undefined) f.set("updatedAt", v)
    return f
  }

  it("parses a valid ISO timestamp into the same instant", () => {
    const d = parseOptimisticUpdatedAt(fd("2025-03-04T05:06:07.890Z"))
    expect(d).toBeInstanceOf(Date)
    expect(d?.toISOString()).toBe("2025-03-04T05:06:07.890Z")
  })
  it("returns null when the field is missing", () => {
    expect(parseOptimisticUpdatedAt(fd())).toBeNull()
  })
  it("returns null for an empty string", () => {
    expect(parseOptimisticUpdatedAt(fd(""))).toBeNull()
  })
  it("returns null for a malformed value", () => {
    expect(parseOptimisticUpdatedAt(fd("not-a-date"))).toBeNull()
  })
  it("returns null for a File (non-string) entry", () => {
    expect(parseOptimisticUpdatedAt(fd(new File(["x"], "x.txt")))).toBeNull()
  })
})

describe("hasEncryptedFieldMatch", () => {
  /** Fake decrypt: strips an "enc:" prefix so tests can see which values reach it. */
  const decrypt = jest.fn((v: string) => v.replace(/^enc:/, ""))
  type Row = { id: number; description: string | null; notes?: string | null }

  beforeEach(() => decrypt.mockClear())

  it("returns false for no candidates", () => {
    expect(hasEncryptedFieldMatch<Row>([], [["description", "x"]], decrypt)).toBe(false)
  })
  it("matches when the decrypted field equals the expected plaintext", () => {
    const rows: Row[] = [{ id: 1, description: "enc:lunch" }]
    expect(hasEncryptedFieldMatch(rows, [["description", "lunch"]], decrypt)).toBe(true)
  })
  it("returns false when no candidate matches", () => {
    const rows: Row[] = [{ id: 1, description: "enc:dinner" }]
    expect(hasEncryptedFieldMatch(rows, [["description", "lunch"]], decrypt)).toBe(false)
  })
  it("requires every listed field to match on the same row", () => {
    const rows: Row[] = [
      { id: 1, description: "enc:lunch", notes: "enc:a" },
      { id: 2, description: "enc:dinner", notes: "enc:b" },
    ]
    expect(hasEncryptedFieldMatch(rows, [["description", "lunch"], ["notes", "b"]], decrypt)).toBe(false)
    expect(hasEncryptedFieldMatch(rows, [["description", "dinner"], ["notes", "b"]], decrypt)).toBe(true)
  })
  it("treats a null encrypted field as a non-match and never decrypts it", () => {
    const rows: Row[] = [{ id: 1, description: null }]
    expect(hasEncryptedFieldMatch(rows, [["description", ""]], decrypt)).toBe(false)
    expect(decrypt).not.toHaveBeenCalled()
  })
  it("treats an undefined field and a non-string field as non-matches", () => {
    const rows: Row[] = [{ id: 1, description: "enc:x" }]
    expect(hasEncryptedFieldMatch(rows, [["notes", "x"]], decrypt)).toBe(false)
    expect(hasEncryptedFieldMatch([{ id: 5 }], [["id", "5"]], decrypt)).toBe(false)
  })
  // Latent: with no checks, every() is vacuously true, so any candidate "matches".
  // Both callers pass a literal check list. Tracked in #215.
  it.todo("returns false when checks is empty")
  it("falls through to a later candidate after a null-field row", () => {
    const rows: Row[] = [{ id: 1, description: null }, { id: 2, description: "enc:lunch" }]
    expect(hasEncryptedFieldMatch(rows, [["description", "lunch"]], decrypt)).toBe(true)
  })
})

describe("isValidEmail", () => {
  it.each(["a@x.com", "first.last@example.com", "a+tag@sub.example.co.uk", "a_b-c@x-y.org", "1@2.io"])(
    "accepts %s",
    (v) => {
      expect(isValidEmail(v)).toBe(true)
    },
  )
  it.each([
    "",
    "plain",
    "@x.com",
    "a@",
    "a@x",
    "a@.com",
    ".a@x.com",
    "a.@x.com",
    "a..b@x.com",
    "a@x..com",
    "a@x.com.",
    "a@-x.com",
    "a@x-.com",
    "a b@x.com",
    "a@x .com",
    "a@@x.com",
    "a@x.c_m",
  ])("rejects %j", (v) => {
    expect(isValidEmail(v)).toBe(false)
  })
  it("enforces the 254-character limit", () => {
    // 64-char local part (the SMTP max) + a long domain of valid <=63-char labels.
    const local = "a".repeat(64)
    const domain = (last: number) => `@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(last)}.com`
    const ok = local + domain(57)
    expect(ok).toHaveLength(254)
    expect(isValidEmail(ok)).toBe(true)
    expect(isValidEmail(local + domain(58))).toBe(false)
  })
  // Latent: only the total length is capped, so a >64-char local part passes. Tracked in #215.
  it.todo("rejects a local part longer than 64 characters")
})
