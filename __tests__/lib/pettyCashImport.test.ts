import { parseCsv, parseRows, resolveAccount, sessionTitle, dedupeKey, matchDonor } from "@/lib/pettyCashImport"

describe("parseCsv", () => {
  it("splits simple rows and trims the trailing newline", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]])
  })
  it("handles quoted fields containing commas", () => {
    expect(parseCsv('date,notes\n2025-09-14,"Vicar, Ta"')).toEqual([
      ["date", "notes"],
      ["2025-09-14", "Vicar, Ta"],
    ])
  })
  it("handles escaped double-quotes inside quoted fields", () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([["a"], ['say "hi"']])
  })
  it("ignores blank lines", () => {
    expect(parseCsv("a\n\n1\n")).toEqual([["a"], ["1"]])
  })
  it("throws on an unterminated quoted field instead of absorbing later lines", () => {
    expect(() => parseCsv('date,notes\n2025-09-14,"Vicar\n2025-09-15,next')).toThrow(/unterminated/i)
  })
})

const HEADER = "date,type,account,payee_or_donor,amount,notes"

describe("parseRows", () => {
  it("parses a valid receipt row", () => {
    const rows = parseRows(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,,122,`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      rowNumber: 1, type: "receipt", accountName: "Sunday Offertory", amount: 122, errors: [],
    })
    expect(rows[0].date?.toISOString()).toBe("2025-09-07T00:00:00.000Z")
  })

  it("accepts DD/MM/YYYY dates", () => {
    const rows = parseRows(`${HEADER}\n14/09/2025,receipt,Sunday Offertory,,50,`)
    expect(rows[0].date?.toISOString()).toBe("2025-09-14T00:00:00.000Z")
    expect(rows[0].errors).toEqual([])
  })

  it("accepts YYYY/MM/DD dates with slashes", () => {
    const rows = parseRows(`${HEADER}\n2025/09/07,receipt,Sunday Offertory,,50,`)
    expect(rows[0].date?.toISOString()).toBe("2025-09-07T00:00:00.000Z")
    expect(rows[0].errors).toEqual([])
  })

  it("accepts D-M-YYYY dates with dashes", () => {
    const rows = parseRows(`${HEADER}\n1-6-2026,receipt,Sunday Offertory,,50,`)
    expect(rows[0].date?.toISOString()).toBe("2026-06-01T00:00:00.000Z")
    expect(rows[0].errors).toEqual([])
  })

  it("rejects mixed date separators", () => {
    expect(parseRows(`${HEADER}\n1-6/2026,receipt,Sunday Offertory,,50,`)[0].errors).toContain("Invalid date")
  })

  it("flags an unparseable date", () => {
    const rows = parseRows(`${HEADER}\n7September2025,receipt,Sunday Offertory,,122,`)
    expect(rows[0].errors).toContain("Invalid date")
  })

  it("flags a non-positive or >2dp amount", () => {
    expect(parseRows(`${HEADER}\n2025-09-07,receipt,X,,0,`)[0].errors).toContain("Amount must be positive")
    expect(parseRows(`${HEADER}\n2025-09-07,receipt,X,,1.234,`)[0].errors).toContain("Amount must have at most 2 decimal places")
    expect(parseRows(`${HEADER}\n2025-09-07,receipt,X,,-5,`)[0].errors).toContain("Amount must be positive")
  })

  it("requires description and payee on expense rows", () => {
    const r = parseRows(`${HEADER}\n2025-09-14,expense,Church Operations,,200,`)[0]
    expect(r.errors).toContain("Expense requires a payee")
    expect(r.errors).toContain("Expense requires a description (notes column)")
  })

  it("rejects an unknown type", () => {
    expect(parseRows(`${HEADER}\n2025-09-07,donation,X,,1,`)[0].errors).toContain("Type must be receipt or expense")
  })

  it("errors when the header is wrong", () => {
    expect(() => parseRows("foo,bar\n1,2")).toThrow(/header/i)
  })
})

const ACCOUNTS = [
  { id: 1, name: "Sunday Offertory", type: "INCOME" as const, isActive: true },
  { id: 2, name: "Church Operations", type: "EXPENSE" as const, isActive: true },
  { id: 3, name: "Old Account", type: "INCOME" as const, isActive: false },
]

describe("resolveAccount", () => {
  it("resolves a matching active INCOME account for a receipt", () => {
    expect(resolveAccount("receipt", "Sunday Offertory", ACCOUNTS)).toEqual({ accountId: 1 })
  })
  it("matches case-insensitively and trimmed", () => {
    expect(resolveAccount("expense", "  church operations ", ACCOUNTS)).toEqual({ accountId: 2 })
  })
  it("errors on unknown account", () => {
    expect(resolveAccount("receipt", "Nope", ACCOUNTS)).toEqual({ error: expect.stringMatching(/Unknown account/) })
  })
  it("errors on type mismatch", () => {
    expect(resolveAccount("receipt", "Church Operations", ACCOUNTS)).toEqual({ error: expect.stringMatching(/not an income account/i) })
  })
  it("errors on inactive account", () => {
    expect(resolveAccount("receipt", "Old Account", ACCOUNTS)).toEqual({ error: expect.stringMatching(/inactive/i) })
  })
})

describe("sessionTitle", () => {
  it("formats a UTC date as DD-MMM-YYYY", () => {
    expect(sessionTitle(new Date("2025-09-07T00:00:00.000Z"))).toBe("07-SEP-2025")
  })
})

describe("dedupeKey", () => {
  it("is stable across equal entries and varies by field", () => {
    const a = dedupeKey({ date: new Date("2025-09-07T00:00:00Z"), type: "receipt", accountId: 1, amount: 122, text: "" })
    const b = dedupeKey({ date: new Date("2025-09-07T00:00:00Z"), type: "receipt", accountId: 1, amount: 122, text: "" })
    const c = dedupeKey({ date: new Date("2025-09-07T00:00:00Z"), type: "receipt", accountId: 1, amount: 50, text: "" })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it("keys on exact integer cents, so string, number and Decimal amounts collide", () => {
    const base = { date: new Date("2025-09-07T00:00:00Z"), type: "receipt" as const, accountId: 1, text: "" }
    const fromString = dedupeKey({ ...base, amount: "122.00" })
    const fromNumber = dedupeKey({ ...base, amount: 122 })
    const fromDecimal = dedupeKey({ ...base, amount: { toString: () => "122.00" } })
    expect(fromString).toBe(fromNumber)
    expect(fromDecimal).toBe(fromNumber)
  })
})

const PEOPLE = [
  { id: 1, firstName: "Amy", middleName: null, lastName: "Taylor", bankingName: null },
  { id: 2, firstName: "Jacob", middleName: null, lastName: "Stanford", bankingName: null },
  { id: 3, firstName: "Jacob", middleName: null, lastName: "Stanford", bankingName: null },
  { id: 4, firstName: "Bella", middleName: "Ann", lastName: "Jay", bankingName: "Bella Jay" },
]

describe("matchDonor", () => {
  it("returns none for empty input", () => {
    expect(matchDonor("", PEOPLE)).toEqual({ status: "none" })
  })
  it("matches a full name exactly (case-insensitive)", () => {
    expect(matchDonor("amy taylor", PEOPLE)).toEqual({ status: "matched", personId: 1, label: "Amy Taylor" })
  })
  it("matches against bankingName", () => {
    expect(matchDonor("Bella Jay", PEOPLE)).toMatchObject({ status: "matched", personId: 4 })
  })
  it("returns ambiguous when more than one person matches the full name", () => {
    // Two people share the full name "Jacob Stanford" — spec matches on full
    // name (not first-name-only), so this is the genuine ambiguous case.
    const r = matchDonor("Jacob Stanford", PEOPLE)
    expect(r.status).toBe("ambiguous")
    if (r.status === "ambiguous") expect(r.candidates.map((c) => c.id).sort()).toEqual([2, 3])
  })
  it("returns none when nothing matches", () => {
    expect(matchDonor("Nobody Here", PEOPLE)).toEqual({ status: "none" })
  })
})
