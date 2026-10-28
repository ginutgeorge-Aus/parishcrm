/** @jest-environment node */
import { encrypt } from "@/lib/crypto"
import { bankRefContentKey, parseAnzStatement, parseAnzTransactionReport } from "@/lib/anzParser"
import { parseOfx } from "@/lib/bankParsers/ofx"
import { parseQif } from "@/lib/bankParsers/qif"
import { fingerprintAccountNumber, sealAccountNumber, unsealAccountNumber } from "@/lib/bankAccountToken"
import {
  accountMask,
  makeAccountTextMasker,
  bankRefMaskSegment,
  hasUnmaskedAccount,
  IMPORT_REF_PREFIX_RE,
  maskBankRef,
  maskContentKey,
  unmaskBankRef,
} from "@/lib/bankRefMask"

const ACCT = "987654321"

describe("maskBankRef / unmaskBankRef", () => {
  it.each([
    [`ANZ_${ACCT}_20250623_60.00_PAYMENTFROMJACK_5176894`, "ANZ_*4321_20250623_60.00_PAYMENTFROMJACK_5176894"],
    [`ANZTR_${ACCT}_20260608_300.00_PAYMENTFROMBRUNO_0`, "ANZTR_*4321_20260608_300.00_PAYMENTFROMBRUNO_0"],
    [`OFX_${ACCT}_20260902_200.00_TRANSFER_F1`, "OFX_*4321_20260902_200.00_TRANSFER_F1"],
  ])("masks and restores %s", (real, masked) => {
    expect(maskBankRef(real, ACCT)).toBe(masked)
    expect(bankRefMaskSegment(masked)).toBe("*4321")
    expect(unmaskBankRef(masked, ACCT)).toBe(real)
  })

  it("is deterministic across re-parses", () => {
    const ref = `ANZ_${ACCT}_20250623_60.00_X_1`
    expect(maskBankRef(ref, ACCT)).toBe(maskBankRef(ref, ACCT))
  })

  it("leaves refs alone when the account is empty or the segment differs", () => {
    expect(maskBankRef("ANZ__20250623_60.00_X_1", "")).toBe("ANZ__20250623_60.00_X_1")
    expect(maskBankRef("QIF_PA3_20260905_10.00_SHOP_1", ACCT)).toBe("QIF_PA3_20260905_10.00_SHOP_1")
    expect(maskBankRef(`ANZ_111_20250623_60.00_X_1`, ACCT)).toBe("ANZ_111_20250623_60.00_X_1")
    expect(maskBankRef("XFER_OUT_ANZ_1", ACCT)).toBe("XFER_OUT_ANZ_1")
  })

  it("masks a content key (dedupKey)", () => {
    expect(maskContentKey(`${ACCT}_20250623_60.00_X`, ACCT)).toBe("*4321_20250623_60.00_X")
    expect(maskContentKey(`${ACCT}_20250623_60.00_X`, "")).toBe(`${ACCT}_20250623_60.00_X`)
  })

  it("unmask returns unmasked refs unchanged and null on a last-4 mismatch", () => {
    expect(unmaskBankRef(`ANZ_${ACCT}_1_2_3_4`, ACCT)).toBe(`ANZ_${ACCT}_1_2_3_4`)
    expect(unmaskBankRef("ANZ_*9999_1_2_3_4", ACCT)).toBeNull()
    expect(unmaskBankRef("ANZ_*4321_1_2_3_4", "")).toBeNull()
  })

  it("accountMask keeps only the last 4 characters", () => {
    expect(accountMask(ACCT)).toBe("*4321")
    expect(accountMask("12")).toBe("*12")
  })

  it("only recognises masks under ANZ_/ANZTR_/OFX_ (QIF passes through)", () => {
    expect(bankRefMaskSegment("QIF_*1234_1_2_3_4")).toBeNull()
    expect(unmaskBankRef("QIF_*1234_1_2_3_4", ACCT)).toBe("QIF_*1234_1_2_3_4")
    expect(bankRefMaskSegment("OFX_*4321_1_2_3_4")).toBe("*4321")
    expect(IMPORT_REF_PREFIX_RE.test("QIF_x")).toBe(true)
  })

  it("hasUnmaskedAccount flags raw ANZ/ANZTR/OFX account segments only", () => {
    expect(hasUnmaskedAccount(`ANZ_${ACCT}_1_2_3_4`)).toBe(true)
    expect(hasUnmaskedAccount(`ANZTR_${ACCT}_1_2_3_4`)).toBe(true)
    expect(hasUnmaskedAccount(`OFX_${ACCT}_1_2_3_4`)).toBe(true)
    expect(hasUnmaskedAccount("ANZ_*4321_1_2_3_4")).toBe(false)
    expect(hasUnmaskedAccount("ANZ__1_2_3_4")).toBe(false)
    expect(hasUnmaskedAccount("QIF_PA3_1_2_3_4")).toBe(false)
    expect(hasUnmaskedAccount("REF-1")).toBe(false)
  })
})

describe("sealAccountNumber / unsealAccountNumber", () => {
  it("round-trips and the token does not reveal the number", () => {
    const token = sealAccountNumber(ACCT)
    expect(token).not.toContain(ACCT)
    expect(unsealAccountNumber(token)).toBe(ACCT)
  })

  it("rejects a tampered token", () => {
    const token = sealAccountNumber(ACCT)
    const parts = token.split(":")
    const ct = Buffer.from(parts[4], "base64")
    ct[0] ^= 0xff
    parts[4] = ct.toString("base64")
    expect(unsealAccountNumber(parts.join(":"))).toBeNull()
  })

  it("rejects ciphertext sealed for another purpose", () => {
    expect(unsealAccountNumber(encrypt(ACCT))).toBeNull()
    expect(unsealAccountNumber(encrypt("bank-acct:v2:123"))).toBeNull()
  })

  it("rejects plaintext that decrypt() would pass straight through", () => {
    expect(unsealAccountNumber(`bank-acct:v1:${ACCT}`)).toBeNull()
  })

  it("rejects missing, non-string and oversized tokens", () => {
    expect(unsealAccountNumber(undefined)).toBeNull()
    expect(unsealAccountNumber(42)).toBeNull()
    expect(unsealAccountNumber("")).toBeNull()
    expect(unsealAccountNumber("e".repeat(600))).toBeNull()
  })
})

// #449: the account number can also appear in the OFX FITID suffix or the
// description segment of a ref — every occurrence is masked, and unmasking is
// exact (`*` never occurs in a genuine ref segment).
describe("inline account masking (#449)", () => {
  it("masks the account number in the FITID suffix and restores it", () => {
    const real = `OFX_${ACCT}_20260902_200.00_TRANSFER_${ACCT}0001`
    const masked = maskBankRef(real, ACCT)
    expect(masked).toBe("OFX_*4321_20260902_200.00_TRANSFER_*43210001")
    expect(masked).not.toContain(ACCT)
    expect(unmaskBankRef(masked, ACCT)).toBe(real)
  })

  it("masks the account number inside the description segment of a content key", () => {
    const key = `${ACCT}_20260902_200.00_TFR${ACCT}`
    expect(maskContentKey(key, ACCT)).toBe("*4321_20260902_200.00_TFR*4321")
  })

  it("rejects a ref carrying a stray mask that does not match the account", () => {
    expect(unmaskBankRef("OFX_*4321_20260902_200.00_X_*9999", ACCT)).toBeNull()
  })

  it("does not inline-mask very short account numbers (would mangle refs)", () => {
    expect(maskBankRef("OFX_12345_20260902_12345.00_X_12345", "12345")).toBe("OFX_*2345_20260902_12345.00_X_12345")
  })
})

describe("makeAccountTextMasker (#449)", () => {
  const mask = makeAccountTextMasker(ACCT)

  it("masks plain and separator-formatted occurrences", () => {
    expect(mask(`TFR FROM ${ACCT} REF 7`)).toBe("TFR FROM *4321 REF 7")
    expect(mask("Acct 9876-54321 and 98765 4321")).toBe("Acct *4321 and *4321")
  })

  it("accepts any short non-alphanumeric separator run (/ _ and mixed)", () => {
    expect(mask("TFR 987/654/321 OK")).toBe("TFR *4321 OK")
    expect(mask("A/C 98765_4321")).toBe("A/C *4321")
    expect(mask("A/C 9876 - 54321")).toBe("A/C *4321")
  })

  it("only masks a whole number, never a substring of a longer alphanumeric token", () => {
    expect(mask("1987654321-005")).toBe("1987654321-005")
    expect(mask("ID987654321")).toBe("ID987654321")
    expect(mask("987654321X")).toBe("987654321X")
    expect(mask("(987654321)")).toBe("(*4321)")
  })

  it("is case-insensitive for alphanumeric account ids", () => {
    expect(makeAccountTextMasker("ab12cd34ef")("REF AB12CD34EF.")).toBe("REF *34ef.")
  })

  it("leaves text without the account number untouched", () => {
    expect(mask("PAYMENT FROM JACK 012345678901234")).toBe("PAYMENT FROM JACK 012345678901234")
    expect(makeAccountTextMasker("")("anything")).toBe("anything")
    expect(makeAccountTextMasker("12345")("ref 12345")).toBe("ref 12345")
  })

  it("returns an empty string for null/undefined text", () => {
    expect(mask(null)).toBe("")
    expect(mask(undefined)).toBe("")
  })
})

describe("fingerprintAccountNumber (#449)", () => {
  it("is deterministic, hex, and does not reveal the number", () => {
    const fp = fingerprintAccountNumber(ACCT)
    expect(fp).toBe(fingerprintAccountNumber(ACCT))
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
    expect(fp).not.toContain(ACCT)
  })

  it("differs for two accounts sharing the same last 4", () => {
    expect(fingerprintAccountNumber("111114321")).not.toBe(fingerprintAccountNumber(ACCT))
  })
})

// Round 2 (#460 review): truncation, case and parser invariants.
describe("desc-segment truncation (#449)", () => {
  const A12 = "000111224821"

  it("masks an account number cut off by the 20-char description limit, reversibly", () => {
    const key = bankRefContentKey(A12, "2026-09-02", "200.00", `PAYMENT TO ${A12}`)
    expect(key).toBe(`${A12}_20260902_200.00_PAYMENTTO00011122482`)
    const masked = maskContentKey(key, A12)
    expect(masked).toBe("*4821_20260902_200.00_PAYMENTTO*4821.P11")
    const ref = `OFX_${key}_F1`
    const maskedRef = maskBankRef(ref, A12)
    expect(maskedRef).not.toMatch(/0001112/)
    expect(unmaskBankRef(maskedRef, A12)).toBe(ref)
  })

  it("leaves a short, untruncated description that merely ends in the same digits", () => {
    const key = bankRefContentKey(A12, "2026-09-02", "200.00", "REF 0001")
    expect(maskContentKey(key, A12)).toBe("*4821_20260902_200.00_REF0001")
  })
})

describe("case-insensitive inline masking (#449)", () => {
  const ALNUM = "ab12cd34ef"

  it("masks the upper-cased copy in the description segment and restores it exactly", () => {
    const ref = `OFX_${ALNUM}_20260902_200.00_TFRAB12CD34EF_F1`
    const masked = maskBankRef(ref, ALNUM)
    expect(masked.toUpperCase()).not.toContain(ALNUM.toUpperCase())
    expect(unmaskBankRef(masked, ALNUM)).toBe(ref)
  })

  it("masks a mixed-case copy in the FITID suffix and restores it exactly", () => {
    const ref = `OFX_${ALNUM}_20260902_200.00_TFR_Ab12cD34EF01`
    const masked = maskBankRef(ref, ALNUM)
    expect(masked.toUpperCase()).not.toContain(ALNUM.toUpperCase())
    expect(unmaskBankRef(masked, ALNUM)).toBe(ref)
  })
})

// unmaskBankRef relies on `*` (and `.` outside the amount) never occurring in a
// genuine ref segment. Pin that for every parser, with hostile input text.
describe("genuine import refs never contain mask characters (#449)", () => {
  const REF_RE = /^(?:ANZ|ANZTR|OFX|QIF)_[A-Za-z0-9]*_\d{8}_\d+\.\d{2}_[A-Z0-9]*_-?[A-Za-z0-9]+$/

  const OFX_TEXT = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>AUD
<BANKACCTFROM><ACCTID>0001-1122*4821</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260902<TRNAMT>200.00<FITID>a*b.c_d-1<NAME>SHOP*CO. #1_X</STMTTRN>
<STMTTRN><DTPOSTED>20260903<TRNAMT>-50.00<NAME>EXAMPLE.SHOP*</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
  const QIF_TEXT = "!Type:Bank\nD05/09/2026\nT-10.00\nPSHOP*CO._X.\n^\nD06/09/2026\nT20.00\nP*.*\n^\n"
  const ANZ_TEXT = `
BUSINESS EXTRA STATEMENT
Account Number 9876-54321
20 JUNE 2025 TO 22 JULY 2025

Date Transaction Details Withdrawals ($) Deposits ($) Balance ($)
2025
20 JUN OPENING BALANCE
51.00
23 JUN PAY*ME.CO_X FROM J
60.00 111.00
24 JUN TFER*.*
6,000.00 5,889.00 DR
TOTALS AT END OF PERIOD
`
  const REPORT_TEXT = `
Transaction Report
CHEQUE ACCOUNT
9 May 2026 to 8 June 2026
Branch Number (BSB) Account Number Balance as of 8 Jun 2026
012345 987654321 $72,733.38
Date Transaction Details Withdrawals Deposits
08 JUN PAYMENT FROM A*B.C_D
blank
$300.00
Total $0.00 $300.00
`

  it.each([
    ["OFX", () => parseOfx(OFX_TEXT).rows],
    ["QIF", () => parseQif(QIF_TEXT, { accountKey: "PA3" }).rows],
    ["ANZ statement", () => parseAnzStatement(ANZ_TEXT).rows],
    ["ANZ report", () => parseAnzTransactionReport(REPORT_TEXT).rows],
  ])("%s refs are [A-Za-z0-9] segments (amount aside)", (_name, rows) => {
    const parsed = rows()
    expect(parsed.length).toBeGreaterThan(0)
    for (const r of parsed) {
      expect(r.bankRef).toMatch(REF_RE)
      expect(r.bankRef).not.toContain("*")
    }
  })
})

describe("fingerprintAccountNumber without the v1 blind-index root (#449)", () => {
  it("falls back to a random per-call value (merge guard fails closed) instead of throwing", () => {
    const saved = { ...process.env }
    try {
      delete process.env.ENCRYPTION_KEY
      delete process.env.ENCRYPTION_KEY_V1
      process.env.ENCRYPTION_KEY_V2 = Buffer.alloc(32, 7).toString("base64")
      process.env.ENCRYPTION_KEY_ID = "v2"
      jest.isolateModules(() => {
        const { fingerprintAccountNumber: fp } = require("@/lib/bankAccountToken") as typeof import("@/lib/bankAccountToken")
        const a = fp(ACCT)
        expect(a).toMatch(/^[0-9a-f]{64}$/)
        expect(fp(ACCT)).not.toBe(a)
      })
    } finally {
      process.env = saved
    }
  })
})
