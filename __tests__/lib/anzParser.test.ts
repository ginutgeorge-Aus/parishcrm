import {
  parseAnzStatement,
  parseAnzTransactionReport,
  bankRefContentKey,
  contentKeyFromBankRef,
} from "@/lib/anzParser"

// Simulates pdf-parse text output for a minimal ANZ Business Extra Statement.
// Format: date line, optional continuation lines, then amounts line (amount + balance).
// Withdrawal column is empty for deposits; deposit column empty for withdrawals.
// In both cases, only one amount appears before the balance.
const SAMPLE_TEXT = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
20 JUNE 2025 TO 22 JULY 2025

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2025
20 JUN OPENING BALANCE
51,708.94
23 JUN PAYMENT FROM JACK SAMPLESONS CARTER
JACK
60.00 51,768.94
23 JUN PAYMENT FROM SEAN ALLEN
EFFECTIVE DATE 21 JUN 2025
300.00 52,068.94
24 JUN ANZ M-BANKING FUNDS TFER
TRANSFER 123456 TO 012345678901234
6,000.00 46,068.94
08 JUL PAYMENT
TO MYOB AUSTRALIA MYOB 2-10000000000
34.00 46,034.94
TOTALS AT END OF PAGE $6,034.00 $660.00
TOTALS AT END OF PERIOD
`

// Sample with amounts on the same line as the date (alternative pdf-parse layout)
const INLINE_SAMPLE = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
20 JUNE 2025 TO 22 JULY 2025

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2025
20 JUN OPENING BALANCE
51,708.94
24 JUN PAYMENT FROM AVA BLACKTHORNE MORGAN 180.00 52,553.04
TOTALS AT END OF PERIOD
`

describe("parseAnzStatement", () => {
  test("extracts statement period", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    expect(result.period.from).toBe("2025-06-20")
    expect(result.period.to).toBe("2025-07-22")
  })

  test("extracts account number (strips dashes)", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    expect(result.accountNumber).toBe("987654321")
  })

  test("skips OPENING BALANCE row", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    expect(result.rows.find((r) => r.description.includes("OPENING BALANCE"))).toBeUndefined()
  })

  test("skips TOTALS rows", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    expect(result.rows.find((r) => r.description.includes("TOTALS"))).toBeUndefined()
  })

  test("parses correct number of transactions", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    expect(result.rows).toHaveLength(4)
  })

  test("parses deposit as INCOME with correct date and amount", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    const row = result.rows.find((r) => r.description.includes("JACK SAMPLESONS"))
    expect(row).toBeDefined()
    expect(row!.type).toBe("INCOME")
    expect(row!.amount).toBe("60.00")
    expect(row!.date).toBe("2025-06-23")
  })

  test("parses withdrawal as EXPENSE", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    const row = result.rows.find((r) => r.description.includes("ANZ M-BANKING"))
    expect(row).toBeDefined()
    expect(row!.type).toBe("EXPENSE")
    expect(row!.amount).toBe("6000.00")
  })

  test("joins multi-line details with pipe separator", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    const row = result.rows.find((r) => r.description.includes("ANZ M-BANKING"))
    expect(row!.details).toContain("TRANSFER 123456")
    expect(row!.details).toContain("|")
  })

  test("excludes EFFECTIVE DATE line from details", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    const row = result.rows.find((r) => r.description.includes("SEAN ALLEN"))
    expect(row!.details).not.toContain("EFFECTIVE DATE")
  })

  test("captures detail lines that follow the amount line", () => {
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
20 JUNE 2025 TO 22 JULY 2025

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2025
20 JUN OPENING BALANCE
51,708.94
23 JUN PAYMENT FROM JACK 60.00 51,768.94
REFERENCE INV-998
24 JUN CLOSING NOTE
70.00 51,838.94
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    const row = result.rows.find((r) => r.description.includes("JACK"))
    expect(row).toBeDefined()
    expect(row!.amount).toBe("60.00")
    // The detail line printed AFTER the amount line was previously dropped.
    expect(row!.details).toContain("REFERENCE INV-998")
  })

  test("generates bankRef with correct format", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    const row = result.rows.find((r) => r.description.includes("JACK SAMPLESONS"))
    expect(row!.bankRef).toBe("ANZ_987654321_20250623_60.00_PAYMENTFROMJACKSAMPL_5176894")
  })

  test("assigns correct year for July transactions", () => {
    const result = parseAnzStatement(SAMPLE_TEXT)
    const row = result.rows.find((r) => r.details.includes("MYOB"))
    expect(row!.date).toBe("2025-07-08")
  })

  test("handles amounts on same line as date (inline layout)", () => {
    const result = parseAnzStatement(INLINE_SAMPLE)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].amount).toBe("180.00")
    expect(result.rows[0].type).toBe("INCOME")
    expect(result.rows[0].description).toBe("PAYMENT FROM AVA BLACKTHORNE MORGAN")
  })

  test("generates distinct bankRefs for two same-day same-amount transactions (collision resistance)", () => {
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JAN 2026 TO 31 JAN 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
01 JAN OPENING BALANCE
10,000.00
15 JAN PAYMENT FROM JOHN SMITH
60.00 10,060.00
15 JAN PAYMENT FROM JOHN SMITH
60.00 10,120.00
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].bankRef).not.toBe(result.rows[1].bankRef)
    // Both rows have same date, amount, and description; only balance differs
    // bankRef format: ANZ_{acct}_{YYYYMMDD}_{amount}_{desc20}_{balanceCents}
    expect(result.rows[0].bankRef).toContain("1006000")  // 10060.00 * 100
    expect(result.rows[1].bankRef).toContain("1012000")  // 10120.00 * 100
  })

  test("reports an error for an unrecognized month in the statement period instead of an invalid ISO date", () => {
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
20 XXX 2025 TO 22 JULY 2025

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2025
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    expect(result.period.from).not.toContain("undefined")
    expect(result.errors.some((e) => /month/i.test(e))).toBe(true)
  })

  test("flags and excludes transactions whose computed date falls outside the statement period", () => {
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JAN 2026 TO 31 JAN 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
01 JAN OPENING BALANCE
10,000.00
15 JAN PAYMENT ONE
60.00 10,060.00
15 DEC STRAY ROW
40.00 10,100.00
20 JAN PAYMENT TWO
50.00 10,150.00
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    // Legitimate in-period row is kept.
    expect(result.rows.find((r) => r.description.includes("PAYMENT ONE"))).toBeDefined()
    // Stray DEC row computes to 2026-12 (outside period) — excluded.
    expect(result.rows.find((r) => r.description.includes("STRAY"))).toBeUndefined()
    // After the DEC row, the monotonic heuristic wrongly bumps JAN to 2027 — also outside, excluded.
    expect(result.rows.find((r) => r.description.includes("PAYMENT TWO"))).toBeUndefined()
    expect(result.errors.some((e) => /outside statement period/i.test(e))).toBe(true)
  })

  test("rejects an impossible calendar date inside the period instead of mis-dating it", () => {
    // 31 FEB lies lexically within a full-year period, so the period guard alone
    // would let "2026-02-31" through — new Date() then rolls it into March.
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JAN 2026 TO 31 DEC 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
01 JAN OPENING BALANCE
10,000.00
31 FEB IMPOSSIBLE ROW
60.00 10,060.00
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    expect(result.rows.find((r) => r.description.includes("IMPOSSIBLE"))).toBeUndefined()
    expect(result.errors.some((e) => /invalid date/i.test(e))).toBe(true)
  })

  test("legacy format: first transaction is EXPENSE when it is a withdrawal below opening balance", () => {
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JAN 2026 TO 31 JAN 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
01 JAN OPENING BALANCE
10,000.00
05 JAN EFTPOS PURCHASE HARDWARE 500.00 9,500.00
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    expect(result.rows).toHaveLength(1)
    // Balance dropped from the 10,000.00 opening balance -> withdrawal -> EXPENSE.
    // Without seeding prevBalance from the opening balance, this defaulted to INCOME.
    expect(result.rows[0].type).toBe("EXPENSE")
    expect(result.rows[0].amount).toBe("500.00")
  })

  test("legacy first row is flagged ambiguousType when opening balance is missing", () => {
    // No "OPENING BALANCE" line -> prevBalance stays null. The first legacy row's
    // sign can't be derived, so it must be flagged for manual review rather than
    // silently defaulting to INCOME.
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JAN 2026 TO 31 JAN 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
05 JAN EFTPOS PURCHASE HARDWARE 500.00 9,500.00
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].ambiguousType).toBe(true)
  })

  test("keeps an overdrawn (DR-suffixed) running balance instead of dropping the row", () => {
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JAN 2026 TO 31 JAN 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
01 JAN OPENING BALANCE
100.00
05 JAN BIG WITHDRAWAL 500.00 400.00 DR
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    // Before the fix, "400.00 DR" matched no amount pattern → the whole row was
    // dropped with a "Could not parse amounts" error.
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].amount).toBe("500.00")
    expect(result.rows[0].type).toBe("EXPENSE")
    // Overdrawn balance is negative cents in the bankRef (−$400.00 → −40000).
    expect(result.rows[0].bankRef).toContain("_-40000")
  })

  test("handles a leading-minus (overdrawn) running balance", () => {
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JAN 2026 TO 31 JAN 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
01 JAN OPENING BALANCE
100.00
05 JAN BIG WITHDRAWAL 500.00 -400.00
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].amount).toBe("500.00")
    expect(result.rows[0].type).toBe("EXPENSE")
    expect(result.rows[0].bankRef).toContain("_-40000")
  })

  test("parses a legacy row whose amount carries a leading minus, storing the magnitude", () => {
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JAN 2026 TO 31 JAN 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
01 JAN OPENING BALANCE
10,000.00
05 JAN PAYMENT REVERSAL -60.00 9,940.00
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    expect(result.rows).toHaveLength(1)
    // Sign is carried by `type`; the stored amount is a positive magnitude.
    expect(result.rows[0].amount).toBe("60.00")
    expect(result.rows[0].type).toBe("EXPENSE")
  })

  test("caps runaway continuation lines to keep one row's details bounded", () => {
    const filler = Array.from({ length: 500 }, (_, i) => `NOISE LINE ${i}`).join("\n")
    const text = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JAN 2026 TO 31 JAN 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
01 JAN OPENING BALANCE
10,000.00
05 JAN EFTPOS PURCHASE HARDWARE
${filler}
500.00 9,500.00
TOTALS AT END OF PERIOD
`
    const result = parseAnzStatement(text)
    // The amounts line was pushed past the 200-line cap, so the row can't parse
    // its amount and is surfaced as an error rather than accreting all 500 lines.
    expect(result.errors.some((e) => /Could not parse amounts/i.test(e))).toBe(true)
  })
})

// Simulates unpdf text output for an ANZ "Transaction Report" (distinct from the
// Business Extra Statement). Differences: mixed-case period with lowercase "to",
// full month names, "$"-prefixed amounts, NO per-row running balance, descending
// (newest-first) dates, "blank" placeholder marks the empty column (its position
// relative to the amount gives the type), and repeated page headers/footers + a
// trailing disclaimer block as noise.
const REPORT_SAMPLE = `
Transaction Report
CHEQUE ACCOUNT
9 May 2026 to 8 June 2026
Account Name Requestor Name Requestor Address
EXAMPLE COMMUNITY CHURCH
CHURCH INCORPORATED
JANE ALEXANDRA SAMPLE 1 EXAMPLE ST
SAMPLETOWN NSW 2000 AUS
Branch Number (BSB) Account Number Balance as of 8 Jun 2026
012345 987654321 $72,733.38
Date Transaction Details Withdrawals Deposits
RECENT 1
08 JUN ANZ MOBILE BANKING PAYMENT 100001 TO PARISH OF EXAMPLE NORTHSIDE $725.00
blank
08 JUN PAYMENT FROM BRUNO TAYLOR WILLIAMSON
blank
$300.00
08 JUN ANZ MOBILE BANKING PAYMENT 100002 TO GRACE COMMUNITY CHURCH SYDNEY INC $2,000.00
blank
Transaction Report generated on 8 June 2026 at 5:20pm AEST/AEDT
Australia and New Zealand Banking Group Limited (ANZ) ABN 11 005 357 522. Page 1 of4
Transaction Report CHEQUE ACCOUNT
9 May 2026 to 8 June 2026 Account Number: 987654321
Date Transaction Details Withdrawals Deposits
13 MAY PAYMENT FROM ROSIE HENDERSON MORGAN MONTHLY SUBSCRIPTION ALEX AND
ROSIE
blank
$60.00
27 MAY PAYMENT FROM MISS RACHEL STANFORD RACHEL KIDS
blank
$10.00
27 MAY PAYMENT FROM MISS RACHEL STANFORD RACHEL
blank
$10.00
Total $6,636.97 $8,111.17
Transaction Report generated on 8 June 2026 at 5:20pm AEST/AEDT
Australia and New Zealand Banking Group Limited (ANZ) ABN 11 005 357 522. Page 1 of4
Transaction Report CHEQUE ACCOUNT
9 May 2026 to 8 June 2026 Account Number: 987654321
Please check your Transaction Report carefully
Your Transaction Report is different to your regular statements.
The balance listed in this document is indicative of the amount in your account.
`

describe("parseAnzTransactionReport", () => {
  test("extracts statement period (mixed case, lowercase 'to', full month names)", () => {
    const result = parseAnzTransactionReport(REPORT_SAMPLE)
    expect(result.period.from).toBe("2026-05-09")
    expect(result.period.to).toBe("2026-06-08")
  })

  test("extracts account number", () => {
    const result = parseAnzTransactionReport(REPORT_SAMPLE)
    expect(result.accountNumber).toBe("987654321")
  })

  test("parses withdrawal (amount before blank) as EXPENSE, stripping $ and commas", () => {
    const result = parseAnzTransactionReport(REPORT_SAMPLE)
    const row = result.rows.find((r) => r.description.includes("PARISH OF EXAMPLE"))
    expect(row).toBeDefined()
    expect(row!.type).toBe("EXPENSE")
    expect(row!.amount).toBe("725.00")
    expect(row!.date).toBe("2026-06-08")
  })

  test("strips commas from large withdrawal amount", () => {
    const result = parseAnzTransactionReport(REPORT_SAMPLE)
    const row = result.rows.find((r) => r.description.includes("GRACE COMMUNITY CHURCH"))
    expect(row!.type).toBe("EXPENSE")
    expect(row!.amount).toBe("2000.00")
  })

  test("parses deposit (blank before amount) as INCOME", () => {
    const result = parseAnzTransactionReport(REPORT_SAMPLE)
    const row = result.rows.find((r) => r.description.includes("BRUNO TAYLOR"))
    expect(row).toBeDefined()
    expect(row!.type).toBe("INCOME")
    expect(row!.amount).toBe("300.00")
  })

  test("joins multi-line description (continuation before blank) with pipe", () => {
    const result = parseAnzTransactionReport(REPORT_SAMPLE)
    const row = result.rows.find((r) => r.description.includes("ROSIE HENDERSON"))
    expect(row!.type).toBe("INCOME")
    expect(row!.amount).toBe("60.00")
    expect(row!.details).toContain("ROSIE")
    expect(row!.details).toContain("|")
  })

  test("excludes noise lines (headers, totals, blank, disclaimer)", () => {
    const result = parseAnzTransactionReport(REPORT_SAMPLE)
    expect(result.rows.find((r) => r.description.includes("Total"))).toBeUndefined()
    expect(result.rows.find((r) => r.description.includes("RECENT"))).toBeUndefined()
    expect(result.rows.find((r) => r.description.toLowerCase().includes("blank"))).toBeUndefined()
    expect(result.rows.find((r) => r.description.includes("generated on"))).toBeUndefined()
    expect(result.rows.find((r) => r.description.includes("balance listed"))).toBeUndefined()
    expect(result.rows).toHaveLength(6)
  })

  test("bankRef uses ANZTR_ prefix", () => {
    const result = parseAnzTransactionReport(REPORT_SAMPLE)
    const row = result.rows.find((r) => r.description.includes("BRUNO TAYLOR"))
    expect(row!.bankRef.startsWith("ANZTR_987654321_20260608_300.00_")).toBe(true)
  })

  test("generates distinct bankRefs for two same-day same-amount same-desc20 rows", () => {
    const result = parseAnzTransactionReport(REPORT_SAMPLE)
    // Both "27 MAY ... RACHEL" $10.00 rows truncate to the same 20-char desc key.
    const rachel = result.rows.filter((r) => r.date === "2026-05-27" && r.amount === "10.00")
    expect(rachel).toHaveLength(2)
    expect(rachel[0].bankRef).not.toBe(rachel[1].bankRef)
  })

  // a description/reference line ending in a bare NN.NN (no $) before the
  // real $-amount must NOT be locked in as the amount. Requiring the leading $
  // makes the parser skip it and pick the true deposit line after "blank".
  test("ignores a bare-decimal reference line and picks the real $-amount", () => {
    const text = `
Transaction Report
CHEQUE ACCOUNT
9 May 2026 to 8 June 2026
Branch Number (BSB) Account Number Balance as of 8 Jun 2026
012345 987654321 $100.00
Date Transaction Details Withdrawals Deposits
08 JUN PAYMENT FROM ALICE REF NO 12345 AMT 25.00
blank
$300.00
`
    const result = parseAnzTransactionReport(text)
    const row = result.rows.find((r) => r.description.includes("ALICE"))
    expect(row).toBeDefined()
    expect(row!.type).toBe("INCOME")
    expect(row!.amount).toBe("300.00")
  })

  test("derives correct year for descending dates across a year boundary", () => {
    const text = `
Transaction Report
CHEQUE ACCOUNT
15 Dec 2025 to 10 Jan 2026
Branch Number (BSB) Account Number Balance as of 10 Jan 2026
012345 987654321 $100.00
Date Transaction Details Withdrawals Deposits
RECENT 1
10 JAN PAYMENT FROM ALICE
blank
$50.00
DEC 2025
20 DEC PAYMENT FROM BOB
blank
$30.00
Total $0.00 $80.00
`
    const result = parseAnzTransactionReport(text)
    expect(result.rows.find((r) => r.description.includes("ALICE"))!.date).toBe("2026-01-10")
    expect(result.rows.find((r) => r.description.includes("BOB"))!.date).toBe("2025-12-20")
  })

  test("drops a row whose computed date falls outside the statement period and reports an error", () => {
    // Period is 15 Dec 2025 → 10 Jan 2026. The ALICE row is in period and kept.
    // The "DEC 2024" separator decrements the working year, so the BOB row
    // computes to 2024-12-20 — before period.from — and must be excluded.
    const text = `
Transaction Report
CHEQUE ACCOUNT
15 Dec 2025 to 10 Jan 2026
Branch Number (BSB) Account Number Balance as of 10 Jan 2026
012345 987654321 $100.00
Date Transaction Details Withdrawals Deposits
10 JAN PAYMENT FROM ALICE
blank
$50.00
DEC 2024
20 DEC PAYMENT FROM BOB
blank
$30.00
Total $0.00 $80.00
`
    const result = parseAnzTransactionReport(text)
    // In-period row kept.
    expect(result.rows.find((r) => r.description.includes("ALICE"))!.date).toBe("2026-01-10")
    // Out-of-period (2024-12-20) row excluded.
    expect(result.rows.find((r) => r.description.includes("BOB"))).toBeUndefined()
    expect(result.errors.some((e) => /outside statement period/i.test(e))).toBe(true)
  })

  test("extracts account number from value line when no colon header present", () => {
    const text = `
Transaction Report
CHEQUE ACCOUNT
15 Dec 2025 to 10 Jan 2026
Branch Number (BSB) Account Number Balance as of 10 Jan 2026
012345 987654321 $100.00
Date Transaction Details Withdrawals Deposits
10 JAN PAYMENT FROM ALICE
blank
$50.00
Total $0.00 $50.00
`
    const result = parseAnzTransactionReport(text)
    expect(result.accountNumber).toBe("987654321")
  })

  test("parses an amount carrying a DR suffix instead of dropping the row", () => {
    const text = `
Transaction Report
CHEQUE ACCOUNT
15 Dec 2025 to 10 Jan 2026
Branch Number (BSB) Account Number Balance as of 10 Jan 2026
012345 987654321 $100.00
Date Transaction Details Withdrawals Deposits
10 JAN PAYMENT REVERSAL $60.00 DR
blank
Total $60.00 $0.00
`
    const result = parseAnzTransactionReport(text)
    const row = result.rows.find((r) => r.description.includes("REVERSAL"))
    expect(row).toBeDefined()
    // Amount before "blank" = Withdrawals column = EXPENSE; the DR marker is
    // stripped and the magnitude stored.
    expect(row!.type).toBe("EXPENSE")
    expect(row!.amount).toBe("60.00")
  })
})

describe("cross-format dedup key", () => {
  // The same real transaction, once as a Business Extra Statement (ANZ_ bankRef,
  // running-balance suffix) and once as a Transaction Report (ANZTR_ bankRef,
  // per-key seq suffix). The two exact bankRefs differ, so the confirm-route exact
  // dedup never catches the second import → income double-posts. Both formats must
  // expose the SAME content key so cross-format re-import can be deduped.
  const STMT_WITH_BRUNO = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
01 JUN 2026 TO 30 JUN 2026

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2026
01 JUN OPENING BALANCE
10,000.00
08 JUN PAYMENT FROM BRUNO TAYLOR WILLIAMSON blank 300.00 10,300.00
TOTALS AT END OF PERIOD
`

  test("statement and report rows for the same transaction share a dedupKey", () => {
    const stmt = parseAnzStatement(STMT_WITH_BRUNO)
    const report = parseAnzTransactionReport(REPORT_SAMPLE)
    const s = stmt.rows.find((r) => r.description.includes("BRUNO"))!
    const r = report.rows.find((r) => r.description.includes("BRUNO"))!
    expect(s).toBeDefined()
    expect(r).toBeDefined()
    // Same account/date/amount/description → identical dedupKey across formats.
    expect(s.dedupKey).toBe(r.dedupKey)
    // The bankRefs themselves still differ (prefix + suffix), which is why the
    // exact-match dedup misses the collision.
    expect(s.bankRef).not.toBe(r.bankRef)
    expect(s.bankRef.startsWith("ANZ_")).toBe(true)
    expect(r.bankRef.startsWith("ANZTR_")).toBe(true)
  })

  test("dedupKey is embedded as a substring of both format bankRefs", () => {
    const stmt = parseAnzStatement(STMT_WITH_BRUNO)
    const report = parseAnzTransactionReport(REPORT_SAMPLE)
    const s = stmt.rows.find((r) => r.description.includes("BRUNO"))!
    const r = report.rows.find((r) => r.description.includes("BRUNO"))!
    expect(s.bankRef).toContain(s.dedupKey)
    expect(r.bankRef).toContain(r.dedupKey)
  })

  test("contentKeyFromBankRef recovers the dedupKey from a stored bankRef of either format", () => {
    const stmt = parseAnzStatement(STMT_WITH_BRUNO)
    const report = parseAnzTransactionReport(REPORT_SAMPLE)
    const s = stmt.rows.find((r) => r.description.includes("BRUNO"))!
    const r = report.rows.find((r) => r.description.includes("BRUNO"))!
    expect(contentKeyFromBankRef(s.bankRef)).toBe(s.dedupKey)
    expect(contentKeyFromBankRef(r.bankRef)).toBe(r.dedupKey)
    // Split-sibling suffix (#2, #3 …) does not change the recovered content key.
    expect(contentKeyFromBankRef(`${s.bankRef}#2`)).toBe(s.dedupKey)
    // The petty-cash paired leg is not a bank line — no content key.
    expect(contentKeyFromBankRef(`XFER_OUT_${s.bankRef}`)).toBeNull()
    // A non-ANZ / manually-keyed ref yields no content key.
    expect(contentKeyFromBankRef("REF-1")).toBeNull()
  })

  test("bankRefContentKey normalizes description consistently (uppercased, non-alphanumeric stripped, 20 chars)", () => {
    const key = bankRefContentKey("987654321", "2026-06-08", "300.00", "payment from bruno taylor williamson")
    expect(key).toBe("987654321_20260608_300.00_PAYMENTFROMBRUNOTAYL")
  })
})
