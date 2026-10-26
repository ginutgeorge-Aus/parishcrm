/** @jest-environment node */

jest.mock("@/lib/featureFlags")
import { POST } from "@/app/api/import/bank-statement/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: jest.fn() },
    appSetting: { findUnique: jest.fn() },
    paymentAccount: { findFirst: jest.fn() },
  },
}))
jest.mock("unpdf", () => ({ extractText: jest.fn().mockResolvedValue({ text: ["MOCK"] }) }))

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>AUD
<BANKACCTFROM><ACCTID>000111224821</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260902<TRNAMT>200.00<FITID>F1<NAME>TRANSFER FROM J CITIZEN</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
const QIF = "!Type:Bank\nD05/09/2026\nT-10.00\nPEXAMPLE SHOP\n^\n"

/** Build a multipart upload request with the given file text and extra fields. */
function upload(text: string, name: string, fields: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append("file", new Blob([text], { type: "application/octet-stream" }), name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return POST(new Request("http://localhost", { method: "POST", body: fd, headers: { "content-length": "1024" } }))
}

describe("POST /api/import/bank-statement — OFX/QIF sources", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ value: '{"4821":3}' })
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue({ id: 3 })
  })

  it("parses OFX and suggests the mapped account", async () => {
    const res = await upload(OFX, "s.ofx", { source: "ofx" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].bankRef).toMatch(/^OFX_/)
    expect(body.suggestedPaymentAccountId).toBe(3)
    expect(body.dateFormatAmbiguous).toBe(false)
    expect(body.possibleDuplicateBankRefs).toEqual([])
  })

  it("parses QIF with the chosen account and reports ambiguous dates", async () => {
    const res = await upload(QIF, "s.qif", { source: "qif", paymentAccountId: "3" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows[0].bankRef).toMatch(/^QIF_PA3_/)
    expect(body.dateFormatAmbiguous).toBe(true)
    expect(body.suggestedPaymentAccountId).toBeNull()
  })

  it("honours an explicit QIF date order", async () => {
    const body = await (await upload(QIF, "s.qif", { source: "qif", paymentAccountId: "3", dateOrder: "MDY" })).json()
    expect(body.rows[0].date).toBe("2026-05-09")
    expect(body.dateFormatAmbiguous).toBe(false)
  })

  it("requires an account for QIF", async () => {
    const res = await upload(QIF, "s.qif", { source: "qif" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Choose the bank account before uploading a QIF file")
  })

  it("explains a source/file mismatch", async () => {
    const res = await upload(QIF, "s.ofx", { source: "ofx" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This looks like a QIF file — go back and choose QIF")
  })

  it("rejects a PDF uploaded as a text source", async () => {
    const res = await upload("%PDF-1.4 ...", "s.ofx", { source: "ofx" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This is a PDF — go back and choose ANZ statement")
  })

  it("rejects an unknown source", async () => {
    const res = await upload(OFX, "s.ofx", { source: "csv" })
    expect(res.status).toBe(400)
  })

  it("returns the parser's fatal error", async () => {
    const res = await upload(OFX.replace("<CURDEF>AUD", "<CURDEF>USD"), "s.ofx", { source: "ofx" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This file is in USD. Only AUD statements can be imported.")
  })

  it("rejects a file with no transactions", async () => {
    const res = await upload("!Type:Bank\n", "s.qif", { source: "qif", paymentAccountId: "3" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("No transactions found in this file")
  })

  it("flags possible duplicates against existing transactions", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockImplementation(({ select }) =>
      Promise.resolve(select.amount ? [{ date: new Date("2026-09-02T00:00:00.000Z"), amount: { toString: () => "200" }, type: "INCOME" }] : []),
    )
    const body = await (await upload(OFX, "s.ofx", { source: "ofx" })).json()
    expect(body.possibleDuplicateBankRefs).toEqual([body.rows[0].bankRef])
  })
})
