import { escapeCsv } from "@/lib/csvUtils"

describe("escapeCsv", () => {
  it("prefixes formula-injection triggers with a single quote", () => {
    expect(escapeCsv("=1+1")).toBe("'=1+1")
    expect(escapeCsv("+cmd")).toBe("'+cmd")
    expect(escapeCsv("@SUM(A1)")).toBe("'@SUM(A1)")
    expect(escapeCsv("-1+cmd")).toBe("'-1+cmd") // leading - but not a plain number → prefixed
  })

  it("leaves a plain negative number numeric, not a text literal", () => {
    expect(escapeCsv("-100.00")).toBe("-100.00")
    expect(escapeCsv(-100)).toBe("-100")
    expect(escapeCsv("-5")).toBe("-5")
  })

  it("leaves plain positive numbers and text untouched", () => {
    expect(escapeCsv("100.00")).toBe("100.00")
    expect(escapeCsv("Tithes")).toBe("Tithes")
  })

  it("quotes and escapes values containing commas, quotes, or newlines", () => {
    expect(escapeCsv("a,b")).toBe(`"a,b"`)
    expect(escapeCsv('a"b')).toBe(`"a""b"`)
    expect(escapeCsv("a\nb")).toBe(`"a\nb"`)
  })

  it("renders null/undefined as empty string", () => {
    expect(escapeCsv(null)).toBe("")
    expect(escapeCsv(undefined)).toBe("")
  })

  it("prefixes a leading Tab or bare CR — a spreadsheet can trim it and expose a formula", () => {
    expect(escapeCsv("\t=1+1")).toBe("'\t=1+1")
    expect(escapeCsv("\r=1+1")).toBe(`"'\r=1+1"`) // also quoted: the raw CR still needs RFC 4180 quoting
  })

  it("neutralizes any '+'-prefixed value, including phone-shaped ones ( supersedes)", () => {
    // A leading + is evaluated by Excel; "+1-1" becomes 0. No regex can tell a
    // phone from arithmetic (both are digits+operators), so all + values are prefixed.
    expect(escapeCsv("+61412345678")).toBe("'+61412345678")
    expect(escapeCsv("+61 412 345 678")).toBe("'+61 412 345 678")
    expect(escapeCsv("+1-1")).toBe("'+1-1")
    // A "(" leading value is not a formula char, so it stays untouched.
    expect(escapeCsv("(02) 1234 5678")).toBe("(02) 1234 5678")
  })

  it("still escapes a '+'-prefixed value that isn't purely phone-number-shaped", () => {
    expect(escapeCsv("+1+1")).toBe("'+1+1")
    expect(escapeCsv("+cmd|'/C calc'!A0")).toBe("'+cmd|'/C calc'!A0")
  })
})
