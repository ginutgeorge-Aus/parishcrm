/** @jest-environment node */
// #459: Transaction.bankRef must not hold the bank account number at rest.
// Every occurrence is replaced by a keyed, deterministic `h<16 hex>` token.
import { hmacBankAccount } from "@/lib/crypto"
import { contentKeyFromBankRef, parseAnzStatement } from "@/lib/anzParser"
import { parseOfx } from "@/lib/bankParsers/ofx"
import { accountOfStoredBankRef, HASHED_ACCOUNT_RE, hashBankRefWith, hashContentKeyWith } from "@/lib/bankRefMask"
import { accountHashToken, hashBankRef, hashContentKey, hashStoredBankRef } from "@/lib/bankRefHash"

const ACCT = "987654321"
const tok = () => `h${hmacBankAccount(ACCT).slice(0, 16)}`

describe("pure hash rewrite (bankRefMask)", () => {
  const T = "habcdef0123456789"
  const digest = "abcdef0123456789" + "0".repeat(48)

  it("replaces the leading account segment", () => {
    expect(hashBankRefWith(`ANZ_${ACCT}_20250623_60.00_X_1`, ACCT, digest)).toBe(`ANZ_${T}_20250623_60.00_X_1`)
    expect(hashContentKeyWith(`${ACCT}_20250623_60.00_X`, ACCT, digest)).toBe(`${T}_20250623_60.00_X`)
  })

  it("replaces inline occurrences in the description and suffix, any case", () => {
    const OFX_ACCT = "AbC123456"
    const ref = `OFX_${OFX_ACCT}_20260902_200.00_TOABC123456X_abc123456F1`
    expect(hashBankRefWith(ref, OFX_ACCT, digest)).toBe(`OFX_${T}_20260902_200.00_TO${T}X_${T}F1`)
  })

  it("replaces a cut-off account prefix at the end of a truncated description", () => {
    const desc = `PAYMENTTO1${ACCT.slice(0, 6)}`.padStart(20, "A") // 20 chars ending with a 6-char prefix
    expect(desc).toHaveLength(20)
    const out = hashBankRefWith(`ANZ_${ACCT}_20250623_60.00_${desc}_1`, ACCT, digest)
    expect(out).toBe(`ANZ_${T}_20250623_60.00_${desc.slice(0, -6)}${T}p6_1`)
  })

  it("keeps the split-sibling suffix", () => {
    expect(hashBankRefWith(`ANZ_${ACCT}_20250623_60.00_X_1#2`, ACCT, digest)).toBe(`ANZ_${T}_20250623_60.00_X_1#2`)
  })

  it("leaves non-matching, QIF, empty-account and manual refs alone", () => {
    expect(hashBankRefWith("QIF_PA3_20260905_10.00_SHOP_1", ACCT, digest)).toBe("QIF_PA3_20260905_10.00_SHOP_1")
    expect(hashBankRefWith("ANZ__20250623_60.00_X_1", "", digest)).toBe("ANZ__20250623_60.00_X_1")
    expect(hashBankRefWith("ANZ_111_20250623_60.00_X_1", ACCT, digest)).toBe("ANZ_111_20250623_60.00_X_1")
    expect(hashBankRefWith("PC_R_12", ACCT, digest)).toBe("PC_R_12")
  })

  it("accountOfStoredBankRef reads the account from the first segment, incl. XFER_OUT_ pairs", () => {
    expect(accountOfStoredBankRef(`ANZ_${ACCT}_1_2_3_4`)).toBe(ACCT)
    expect(accountOfStoredBankRef(`ANZTR_${ACCT}_1_2_3_4#3`)).toBe(ACCT)
    expect(accountOfStoredBankRef(`XFER_OUT_OFX_${ACCT}_1_2_3_4`)).toBe(ACCT)
    expect(accountOfStoredBankRef(`ANZ_${T}_1_2_3_4`)).toBeNull()
    expect(accountOfStoredBankRef("ANZ_*4321_1_2_3_4")).toBeNull()
    expect(accountOfStoredBankRef("ANZ__1_2_3_4")).toBeNull()
    expect(accountOfStoredBankRef("QIF_PA3_1_2_3_4")).toBeNull()
    expect(accountOfStoredBankRef("PC_T_9")).toBeNull()
    expect(HASHED_ACCOUNT_RE.test(T)).toBe(true)
  })
})

describe("keyed hash (bankRefHash)", () => {
  it("token is h + the first 16 hex of hmacBankAccount", () => {
    expect(accountHashToken(ACCT)).toBe(tok())
    expect(accountHashToken(ACCT)).toMatch(HASHED_ACCOUNT_RE)
    expect(accountHashToken("123456789")).not.toBe(accountHashToken(ACCT))
  })

  it("hashed refs never contain the account number and stay deterministic", () => {
    for (const r of parseAnzStatement(ANZ_TEXT).rows) {
      const h = hashBankRef(r.bankRef, ACCT)
      expect(h).not.toContain(ACCT)
      expect(h).toBe(hashBankRef(r.bankRef, ACCT))
      expect(h.startsWith(`ANZ_${tok()}_`)).toBe(true)
    }
  })

  it("the content key of a hashed ref equals the hashed dedupKey (cross-format dedup still works)", () => {
    for (const r of [...parseAnzStatement(ANZ_TEXT).rows, ...parseOfx(OFX).rows]) {
      const acct = accountOfStoredBankRef(r.bankRef)!
      expect(contentKeyFromBankRef(hashBankRef(r.bankRef, acct))).toBe(hashContentKey(r.dedupKey, acct))
    }
  })

  it("hashStoredBankRef derives the account from the ref, handles XFER_OUT_ and is idempotent", () => {
    const ref = `ANZ_${ACCT}_20250623_60.00_X_1`
    const h = hashStoredBankRef(ref)
    expect(h).toBe(hashBankRef(ref, ACCT))
    expect(hashStoredBankRef(h)).toBe(h)
    expect(hashStoredBankRef(`XFER_OUT_${ref}`)).toBe(`XFER_OUT_${h}`)
    expect(hashStoredBankRef(`${ref}#2`)).toBe(`${h}#2`)
    expect(hashStoredBankRef("QIF_PA3_20260905_10.00_SHOP_1")).toBe("QIF_PA3_20260905_10.00_SHOP_1")
    expect(hashStoredBankRef("PC_E_4")).toBe("PC_E_4")
  })
})

const ANZ_TEXT = `
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
24 JUN ANZ M-BANKING FUNDS TFER
TRANSFER 123456 TO 987654321
6,000.00 45,768.94
TOTALS AT END OF PERIOD
`
const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>AUD
<BANKACCTFROM><ACCTID>000111224821</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260902<TRNAMT>200.00<FITID>0001112248210001<NAME>TRANSFER FROM 000111224821</STMTTRN>
<STMTTRN><DTPOSTED>20260903<TRNAMT>-50.00<FITID>F2<NAME>EXAMPLE SHOP</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
