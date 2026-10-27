// __tests__/lib/bankParsers/ofx.test.ts
import { detectOfx, parseOfx } from "@/lib/bankParsers/ofx"
import { bankRefContentKey } from "@/lib/anzParser"

// Synthetic OFX 1.x (SGML: leaf tags are not closed).
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>AUD
<BANKACCTFROM><BANKID>012345<ACCTID>000111222333<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901000000
<DTEND>20260930000000
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260902120000.000[+10:AEST]
<TRNAMT>200.00
<FITID>2026090201-A
<NAME>TRANSFER FROM J CITIZEN
<MEMO>Tithe
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260903
<TRNAMT>-312.4
<FITID>2026090302
<NAME>EXAMPLE ENERGY
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`

// Synthetic OFX 2.x (XML: every tag closed), credit-card account.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
<CURDEF>AUD</CURDEF>
<CCACCTFROM><ACCTID>4000-0000-0000-9999</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260905</DTPOSTED><TRNAMT>-86.10</TRNAMT><FITID>X1</FITID><NAME>EXAMPLE GROCER</NAME><MEMO>Card 9999</MEMO></STMTTRN>
</BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`

describe("detectOfx", () => {
  it("detects SGML header, XML header and bare <OFX>", () => {
    expect(detectOfx(SGML)).toBe(true)
    expect(detectOfx(XML)).toBe(true)
    expect(detectOfx("<OFX><BANKMSGSRSV1>")).toBe(true)
  })
  it("rejects QIF and plain text", () => {
    expect(detectOfx("!Type:Bank\nD01/09/2026\n^")).toBe(false)
    expect(detectOfx("hello")).toBe(false)
  })
})

describe("parseOfx", () => {
  it("parses SGML rows, period and account", () => {
    const r = parseOfx(SGML)
    expect(r.fatalError).toBeUndefined()
    expect(r.accountNumber).toBe("000111222333")
    expect(r.period).toEqual({ from: "2026-09-01", to: "2026-09-30" })
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({
      date: "2026-09-02",
      description: "TRANSFER FROM J CITIZEN",
      details: "Tithe",
      amount: "200.00",
      type: "INCOME",
    })
    expect(r.rows[1]).toMatchObject({ date: "2026-09-03", amount: "312.40", type: "EXPENSE", details: "" })
  })

  it("builds OFX_ bankRef from content key + sanitised FITID", () => {
    const row = parseOfx(SGML).rows[0]
    const key = bankRefContentKey("000111222333", "2026-09-02", "200.00", "TRANSFER FROM J CITIZEN")
    expect(row.dedupKey).toBe(key)
    expect(row.bankRef).toBe(`OFX_${key}_2026090201A`)
  })

  it("parses XML credit-card statements and strips account separators", () => {
    const r = parseOfx(XML)
    expect(r.accountNumber).toBe("4000000000009999")
    expect(r.rows[0]).toMatchObject({ date: "2026-09-05", amount: "86.10", type: "EXPENSE", description: "EXAMPLE GROCER" })
    // No DTSTART/DTEND → period from row dates.
    expect(r.period).toEqual({ from: "2026-09-05", to: "2026-09-05" })
  })

  it("falls back to a per-content-key sequence when FITID is missing", () => {
    const text = SGML.replace("<FITID>2026090302\n", "")
    const row = parseOfx(text).rows[1]
    expect(row.bankRef).toBe(`OFX_${row.dedupKey}_S1`)
  })

  it("uses MEMO as description when NAME is absent", () => {
    const text = XML.replace("<NAME>EXAMPLE GROCER</NAME>", "")
    expect(parseOfx(text).rows[0]).toMatchObject({ description: "Card 9999", details: "" })
  })

  it("skips malformed transactions into errors", () => {
    const text = SGML.replace("<TRNAMT>-312.4", "<TRNAMT>abc").replace("<DTPOSTED>20260902120000.000[+10:AEST]", "<DTPOSTED>20260231")
    const r = parseOfx(text)
    expect(r.rows).toHaveLength(0)
    expect(r.errors).toHaveLength(2)
  })

  it("rejects non-AUD currency", () => {
    const r = parseOfx(SGML.replace("<CURDEF>AUD", "<CURDEF>USD"))
    expect(r.rows).toEqual([])
    expect(r.fatalError).toBe("This file is in USD. Only AUD statements can be imported.")
  })

  it("rejects files with more than one account", () => {
    const two = SGML.replace("</STMTRS>", "</STMTRS><STMTRS><BANKACCTFROM><ACCTID>999</BANKACCTFROM></STMTRS>")
    expect(parseOfx(two).fatalError).toBe("This file contains more than one account. Export one account at a time.")
  })
})

describe("parseOfx hardening", () => {
  const wrap = (acct: string, trn: string) => `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>AUD
<BANKACCTFROM><ACCTID>${acct}</BANKACCTFROM>
<BANKTRANLIST>
${trn}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

  it("ignores a transfer-to ACCTID inside a STMTTRN", () => {
    const r = parseOfx(wrap("000111222333", "<STMTTRN><DTPOSTED>20260902<TRNAMT>-5.00<FITID>F1<NAME>XFER<BANKACCTTO><ACCTID>999888777</BANKACCTTO></STMTTRN>"))
    expect(r.fatalError).toBeUndefined()
    expect(r.accountNumber).toBe("000111222333")
    expect(r.rows).toHaveLength(1)
  })

  it("decodes XML character entities in values", () => {
    const r = parseOfx(wrap("1", "<STMTTRN><DTPOSTED>20260902<TRNAMT>-5.00<FITID>F1<NAME>SMITH &amp; SONS &lt;X&gt; &quot;Q&quot; &apos;A&apos; &#65;&#x42; &bogus; &#1114112;<MEMO>m</STMTTRN>"))
    expect(r.rows[0].description).toBe("SMITH & SONS <X> \"Q\" 'A' AB &bogus; &#1114112;")
  })

  it("does not double-decode", () => {
    const r = parseOfx(wrap("1", "<STMTTRN><DTPOSTED>20260902<TRNAMT>-5.00<FITID>F1<NAME>A &amp;lt; B</STMTTRN>"))
    expect(r.rows[0].description).toBe("A &lt; B")
  })

  it("truncates description and details to the confirm limits", () => {
    const r = parseOfx(wrap("1", `<STMTTRN><DTPOSTED>20260902<TRNAMT>-5.00<FITID>F1<NAME>${"N".repeat(700)}<MEMO>${"M".repeat(1500)}</STMTTRN>`))
    expect(r.rows[0].description).toHaveLength(500)
    expect(r.rows[0].details).toHaveLength(1000)
  })

  it("rejects an amount too large for Decimal(10,2)", () => {
    const r = parseOfx(wrap("1", "<STMTTRN><DTPOSTED>20260902<TRNAMT>123456789.00<FITID>F1<NAME>BIG</STMTTRN>"))
    expect(r.rows).toHaveLength(0)
    expect(r.errors).toHaveLength(1)
  })
})
