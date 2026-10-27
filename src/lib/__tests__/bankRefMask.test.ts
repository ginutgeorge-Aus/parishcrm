/** @jest-environment node */
import { encrypt } from "@/lib/crypto"
import { sealAccountNumber, unsealAccountNumber } from "@/lib/bankAccountToken"
import {
  accountMask,
  bankRefMaskSegment,
  hasUnmaskedAccount,
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
