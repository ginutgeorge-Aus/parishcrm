/** @jest-environment node */

// #446: the parse response must never carry the full bank account number, yet
// re-imports must still dedup against stored full-number bankRefs, and confirm
// must restore masked refs only with a genuine sealed token.

jest.mock("@/lib/featureFlags")
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({
  getAccountingLockDate: jest.fn().mockResolvedValue(null),
  isDateLocked: jest.fn(() => false),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    family: { findMany: jest.fn() },
    person: { findMany: jest.fn() },
    appSetting: { findUnique: jest.fn() },
    paymentAccount: { findFirst: jest.fn(), findMany: jest.fn() },
    transaction: { findMany: jest.fn(), createMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock("unpdf", () => ({ extractText: jest.fn() }))

import { extractText } from "unpdf"
import { POST } from "@/app/api/import/bank-statement/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { parseAnzStatement } from "@/lib/anzParser"
import { parseOfx } from "@/lib/bankParsers/ofx"
import { confirmBankImport } from "@/lib/bankImportConfirm"
import { encrypt } from "@/lib/crypto"
import { sealAccountNumber } from "@/lib/bankAccountToken"

const ACCT = "987654321"
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
TRANSFER 123456 TO 012345678901234
6,000.00 45,768.94
TOTALS AT END OF PERIOD
`
const OFX_ACCT = "000111224821"
const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>AUD
<BANKACCTFROM><ACCTID>${OFX_ACCT}</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260902<TRNAMT>200.00<FITID>F1<NAME>TRANSFER FROM J CITIZEN</STMTTRN>
<STMTTRN><DTPOSTED>20260903<TRNAMT>-50.00<FITID>F2<NAME>EXAMPLE SHOP</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

const txFindMany = prisma.transaction.findMany as jest.Mock
const createMany = prisma.transaction.createMany as jest.Mock
let actor = 0

/** Upload a file through the parse route as a fresh actor (sidesteps the per-user rate limit). */
async function parse(body: string, name: string, source: string) {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: String(5000 + ++actor), role: "ADMIN" } })
  const fd = new FormData()
  fd.append("file", new Blob([body], { type: "application/octet-stream" }), name)
  fd.append("source", source)
  const res = await POST(new Request("http://localhost", { method: "POST", body: fd, headers: { "content-length": "1024" } }))
  return { status: res.status, body: await res.json() }
}

/** Turn parse-response rows into confirm rows (category by type, bank account 1, none skipped). */
function toConfirmRows(rows: Array<Record<string, unknown>>) {
  return rows.map((r) => ({ ...r, accountId: r.type === "INCOME" ? 5 : 6, paymentAccountId: 1, skip: false }))
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(extractText as jest.Mock).mockResolvedValue({ text: [ANZ_TEXT] })
  txFindMany.mockResolvedValue([])
  ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue(null)
  ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue(null)
  ;(prisma.paymentAccount.findMany as jest.Mock).mockResolvedValue([{ id: 1, name: "ANZ Church", kind: "BANK", isActive: true }])
  ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
    { id: 5, type: "INCOME", isActive: true },
    { id: 6, type: "EXPENSE", isActive: true },
  ])
  createMany.mockImplementation((args: { data: unknown[] }) => Promise.resolve({ count: args.data.length }))
})

describe("parse response masking", () => {
  it("ANZ: no full account number anywhere in the response", async () => {
    const { status, body } = await parse("%PDF-1.4", "s.pdf", "anz")
    expect(status).toBe(200)
    expect(body.rows).toHaveLength(2)
    expect(JSON.stringify(body)).not.toContain(ACCT)
    for (const r of body.rows) expect(r.bankRef).toMatch(/^ANZ_\*4321_/)
    expect(typeof body.accountToken).toBe("string")
    expect(body.accountSuffix).toBe("4321")
  })

  it("OFX: no full account number anywhere in the response", async () => {
    const { status, body } = await parse(OFX, "s.ofx", "ofx")
    expect(status).toBe(200)
    expect(body.rows).toHaveLength(2)
    expect(JSON.stringify(body)).not.toContain(OFX_ACCT)
    for (const r of body.rows) expect(r.bankRef).toMatch(/^OFX_\*4821_/)
  })

  it("QIF: no token and refs unchanged (account key is an internal id)", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue({ id: 3 })
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "4999", role: "ADMIN" } })
    const fd = new FormData()
    fd.append("file", new Blob(["!Type:Bank\nD05/09/2026\nT-10.00\nPEXAMPLE SHOP\n^\n"]), "s.qif")
    fd.append("source", "qif")
    fd.append("paymentAccountId", "3")
    const res = await POST(new Request("http://localhost", { method: "POST", body: fd, headers: { "content-length": "1024" } }))
    const body = await res.json()
    expect(body.rows[0].bankRef).toMatch(/^QIF_PA3_/)
    expect(body.accountToken).toBeUndefined()
  })
})

describe("re-import of an already-imported statement (old-format full-number refs in DB)", () => {
  it("ANZ: parse flags every row duplicate; confirm with masked rows + token skips them all", async () => {
    const stored = parseAnzStatement(ANZ_TEXT).rows.map((r) => ({ bankRef: r.bankRef, type: r.type, date: new Date(r.date), amount: r.amount }))
    txFindMany.mockResolvedValue(stored)
    const { body } = await parse("%PDF-1.4", "s.pdf", "anz")
    expect(body.duplicateBankRefs).toEqual(body.rows.map((r: { bankRef: string }) => r.bankRef))

    const result = await confirmBankImport({ rows: toConfirmRows(body.rows), accountToken: body.accountToken })
    expect(result).toEqual({ ok: true, imported: 0, skipped: 0, duplicates: 2 })
    expect(createMany).not.toHaveBeenCalled()
    // Dedup lookups ran on the restored full-number refs.
    const exactLookup = txFindMany.mock.calls.find((c) => c[0]?.where?.bankRef?.in)
    expect(exactLookup[0].where.bankRef.in).toEqual(expect.arrayContaining(stored.map((s) => s.bankRef)))
  })

  it("ANZ cross-format: DB holds ANZTR_ refs, statement re-import is still all duplicates", async () => {
    const stored = parseAnzStatement(ANZ_TEXT).rows.map((r) => ({
      bankRef: `ANZTR_${r.dedupKey}_0`,
      type: r.type,
      date: new Date(r.date),
      amount: r.amount,
    }))
    txFindMany.mockResolvedValue(stored)
    const { body } = await parse("%PDF-1.4", "s.pdf", "anz")
    expect(body.duplicateBankRefs).toHaveLength(2)
    expect(JSON.stringify(body)).not.toContain(ACCT)

    const result = await confirmBankImport({ rows: toConfirmRows(body.rows), accountToken: body.accountToken })
    expect(result).toEqual({ ok: true, imported: 0, skipped: 0, duplicates: 2 })
  })

  it("OFX: re-import against stored full-number refs is all duplicates", async () => {
    const stored = parseOfx(OFX).rows.map((r) => ({ bankRef: r.bankRef, type: r.type, date: new Date(r.date), amount: r.amount }))
    txFindMany.mockResolvedValue(stored)
    const { body } = await parse(OFX, "s.ofx", "ofx")
    expect(body.duplicateBankRefs).toHaveLength(2)
    const result = await confirmBankImport({ rows: toConfirmRows(body.rows), accountToken: body.accountToken })
    expect(result).toEqual({ ok: true, imported: 0, skipped: 0, duplicates: 2 })
  })

  it("fresh import inserts the restored full-number refs", async () => {
    const { body } = await parse("%PDF-1.4", "s.pdf", "anz")
    const result = await confirmBankImport({ rows: toConfirmRows(body.rows), accountToken: body.accountToken })
    expect(result).toEqual({ ok: true, imported: 2, skipped: 0, duplicates: 0 })
    const inserted = createMany.mock.calls[0][0].data.map((d: { bankRef: string }) => d.bankRef)
    expect(inserted).toEqual(parseAnzStatement(ANZ_TEXT).rows.map((r) => r.bankRef))
  })
})

describe("confirm token validation", () => {
  const maskedRow = {
    date: "2025-06-23",
    description: "PAYMENT FROM JACK",
    amount: "60.00",
    type: "INCOME" as const,
    bankRef: "ANZ_*4321_20250623_60.00_PAYMENTFROMJACKSAM_5176894",
    accountId: 5,
    paymentAccountId: 1,
    skip: false,
  }
  const invalid = { ok: false, status: 400, error: "This statement review has expired. Re-upload the statement and try again." }

  it("rejects masked rows with no token", async () => {
    expect(await confirmBankImport({ rows: [maskedRow] })).toEqual(invalid)
    expect(await confirmBankImport([maskedRow])).toEqual(invalid)
  })

  it("rejects a tampered token", async () => {
    const parts = sealAccountNumber(ACCT).split(":")
    const ct = Buffer.from(parts[4], "base64")
    ct[ct.length - 1] ^= 0x01
    parts[4] = ct.toString("base64")
    expect(await confirmBankImport({ rows: [maskedRow], accountToken: parts.join(":") })).toEqual(invalid)
  })

  it("rejects a wrong-purpose ciphertext and a plaintext token", async () => {
    expect(await confirmBankImport({ rows: [maskedRow], accountToken: encrypt(ACCT) })).toEqual(invalid)
    expect(await confirmBankImport({ rows: [maskedRow], accountToken: `bank-acct:v1:${ACCT}` })).toEqual(invalid)
  })

  it("rejects a mask whose last 4 doesn't match the sealed number", async () => {
    const result = await confirmBankImport({ rows: [maskedRow], accountToken: sealAccountNumber("111122223333") })
    expect(result).toEqual(invalid)
    expect(createMany).not.toHaveBeenCalled()
  })

  it("keeps the generic error for schema failures", async () => {
    expect(await confirmBankImport({ rows: "nope" })).toEqual({ ok: false, status: 400, error: "Invalid request data" })
  })

  it("treats a QIF ref with a mask-looking segment as an ordinary ref", async () => {
    const result = await confirmBankImport({ rows: [{ ...maskedRow, bankRef: "QIF_*1234_20260905_10.00_SHOP_1" }] })
    expect(result).toEqual({ ok: true, imported: 1, skipped: 0, duplicates: 0 })
  })

  it("passes unmasked rows through without a token", async () => {
    const result = await confirmBankImport({ rows: [{ ...maskedRow, bankRef: "QIF_PA3_20260905_10.00_SHOP_1" }] })
    expect(result).toEqual({ ok: true, imported: 1, skipped: 0, duplicates: 0 })
  })
})
