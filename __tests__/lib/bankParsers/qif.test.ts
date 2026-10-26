import { detectQif, parseQif } from "@/lib/bankParsers/qif"
import { bankRefContentKey } from "@/lib/anzParser"

const BANK = `!Type:Bank
D25/09/2026
T200.00
PTRANSFER FROM J CITIZEN
MTithe
^
D03/09/2026
T-312.40
PEXAMPLE ENERGY
N1001
^
`

describe("detectQif", () => {
  it("detects Bank and CCard headers", () => {
    expect(detectQif(BANK)).toBe(true)
    expect(detectQif("!Type:CCard\nD1/1/26\n^")).toBe(true)
  })
  it("rejects other types and OFX", () => {
    expect(detectQif("!Type:Invst\n^")).toBe(false)
    expect(detectQif("<OFX>")).toBe(false)
  })
})

describe("parseQif", () => {
  const opts = { accountKey: "PA7" }

  it("parses rows and infers DD/MM when a day > 12 appears", () => {
    const r = parseQif(BANK, opts)
    expect(r.dateFormatAmbiguous).toBeUndefined()
    expect(r.accountNumber).toBe("")
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ date: "2026-09-25", amount: "200.00", type: "INCOME", description: "TRANSFER FROM J CITIZEN", details: "Tithe" })
    expect(r.rows[1]).toMatchObject({ date: "2026-09-03", amount: "312.40", type: "EXPENSE", details: "" })
    expect(r.period).toEqual({ from: "2026-09-03", to: "2026-09-25" })
  })

  it("builds QIF_ bankRef with the account key and an occurrence index", () => {
    const dup = BANK + BANK.replace("!Type:Bank\n", "")
    const rows = parseQif(dup, opts).rows
    const key = bankRefContentKey("PA7", "2026-09-25", "200.00", "TRANSFER FROM J CITIZEN")
    expect(rows[0].bankRef).toBe(`QIF_${key}_1`)
    expect(rows[2].bankRef).toBe(`QIF_${key}_2`)
    expect(rows[0].dedupKey).toBe(key)
  })

  it("infers MM/DD when a second component > 12 appears", () => {
    const us = BANK.replace("D25/09/2026", "D09/25/2026").replace("D03/09/2026", "D09/03/2026")
    expect(parseQif(us, opts).rows.map((r) => r.date)).toEqual(["2026-09-25", "2026-09-03"])
  })

  it("flags ambiguity and defaults to DD/MM, honouring an explicit order", () => {
    const amb = BANK.replace("D25/09/2026", "D05/09/2026")
    const r = parseQif(amb, opts)
    expect(r.dateFormatAmbiguous).toBe(true)
    expect(r.rows[0].date).toBe("2026-09-05")
    const us = parseQif(amb, { ...opts, dateOrder: "MDY" })
    expect(us.dateFormatAmbiguous).toBeUndefined()
    expect(us.rows[0].date).toBe("2026-05-09")
  })

  it("rejects a file mixing DD/MM and MM/DD evidence", () => {
    const mixed = BANK.replace("D03/09/2026", "D09/25/2026")
    expect(parseQif(mixed, opts).fatalError).toBe("Dates in this file use mixed formats and can't be read reliably.")
  })

  it("handles 2-digit and apostrophe years, ISO dates, and U amounts", () => {
    const text = "!Type:CCard\nD5/9'26\nU-1,234.50\nPA\n^\nD2026-09-30\nT10\nPB\n^\n"
    const rows = parseQif(text, opts).rows
    expect(rows.map((r) => [r.date, r.amount, r.type])).toEqual([
      ["2026-09-05", "1234.50", "EXPENSE"],
      ["2026-09-30", "10.00", "INCOME"],
    ])
  })

  it("skips records with bad date/amount/payee into errors", () => {
    const bad = "!Type:Bank\nD31/02/2026\nT1\nPX\n^\nD01/09/2026\nTabc\nPY\n^\nD02/09/2026\nT5\n^\n"
    const r = parseQif(bad, opts)
    expect(r.rows).toEqual([])
    expect(r.errors).toHaveLength(3)
  })

  it("tolerates CRLF and a missing trailing ^", () => {
    const text = "!Type:Bank\r\nD25/09/2026\r\nT1.00\r\nPX\r\n"
    expect(parseQif(text, opts).rows).toHaveLength(1)
  })
})

describe("qif hardening", () => {
  const opts = { accountKey: "PA1" }

  it("detects a Bank header after an Option/Account preamble", () => {
    const t = "!Option:AutoSwitch\n!Account\nNMy Bank\nTBank\n^\n!Clear:AutoSwitch\n!Type:Bank\nD25/09/2026\nT-1.00\nPSHOP\n^\n"
    expect(detectQif(t)).toBe(true)
    const r = parseQif(t, opts)
    expect(r.rows).toHaveLength(1)
    expect(r.errors).toEqual([])
  })

  it("ignores records in non-transaction sections", () => {
    const t = "!Type:Cat\nNTithe\nD25/09/2026\nT9.00\nPCAT\n^\n!Type:Bank\nD25/09/2026\nT-1.00\nPSHOP\n^\n"
    expect(parseQif(t, opts).rows.map((r) => r.description)).toEqual(["SHOP"])
  })

  it("accepts Quicken-style spaces in dates", () => {
    const t = "!Type:Bank\nD 5/ 9'26\nT-1.00\nPA\n^\nD25/ 9/2026\nT-1.00\nPB\n^\n"
    const r = parseQif(t, opts)
    expect(r.errors).toEqual([])
    expect(r.rows.map((x) => x.date)).toEqual(["2026-09-05", "2026-09-25"])
  })

  it("truncates payee/memo and rejects oversize amounts", () => {
    const t = `!Type:Bank\nD25/09/2026\nT-1.00\nP${"P".repeat(700)}\nM${"M".repeat(1500)}\n^\nD25/09/2026\nT123456789.00\nPBIG\n^\n`
    const r = parseQif(t, opts)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].description).toHaveLength(500)
    expect(r.rows[0].details).toHaveLength(1000)
    expect(r.errors).toHaveLength(1)
  })
})
