jest.mock("@/lib/featureFlags")
import {
  createDgrReceipt,
  updateDgrReceipt,
  deleteDgrReceipt,
  sendDgrReceipt,
  listDgrReceipts,
  getDonorEmail,
} from "@/lib/actions/dgrReceipt"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit, logAuditTx } from "@/lib/audit"
import { AUDIT_FAILED_ERROR } from "@/lib/auditGuard"
import { sendDgrReceiptEmail } from "@/lib/email"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  encryptBytes: jest.fn((b: Uint8Array) => Buffer.from(`enc:${Buffer.from(b).toString("base64")}`)),
  decryptBytes: jest.fn((b: Uint8Array) => Buffer.from(Buffer.from(b).toString("utf8").replace(/^enc:/, ""), "base64")),
}))
jest.mock("@/lib/email", () => ({
  sendDgrReceiptEmail: jest.fn(),
  // Real classifier: the tests below drive it with real SMTP error codes.
  isAmbiguousDeliveryError: jest.requireActual("@/lib/email").isAmbiguousDeliveryError,
}))
jest.mock("@/lib/pdf/DgrReceiptPdf", () => ({ renderDgrReceiptPdf: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettingsForReceipt: jest.fn(async () => ({
    church: {
      name: "Example Church",
      address: "1 Example St",
      abn: "51824753556",
      email: "church@example.com",
      website: "",
    },
  })),
}))
jest.mock("@/lib/receiptSettings", () => ({
  getReceiptSettings: jest.fn(async () => ({
    numberPrefix: "DGR",
    documentTitle: "ANNUAL TAX-DEDUCTIBLE RECEIPT",
    totalLabel: "TOTAL TAX-DEDUCTIBLE DONATIONS",
    coveredPeriodTemplate: "This receipt covers tax-deductible gifts received between {from} and {to}.",
    legalText: "Test legal text",
  })),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findUnique: jest.fn() },
    dgrReceipt: {
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}))

// Captured at load, before any jest.resetModules() in the suite: a later requireActual would bind
// the real helper to a fresh prisma mock instance instead of the one the action under test uses.
const realLogAudit = jest.requireActual("@/lib/audit").logAudit as typeof logAudit

const mockAuth = auth as jest.Mock
const mockLogAudit = logAudit as jest.Mock
const mockLogAuditTx = logAuditTx as jest.Mock
const mockSendEmail = sendDgrReceiptEmail as jest.Mock
const mockRenderPdf = renderDgrReceiptPdf as jest.Mock

function formDataWithLines(overrides: Partial<Record<string, string>> = {}, lines: unknown = [
  { date: "2024-07-24", amount: 100, method: "Bank Transfer" },
]): FormData {
  const fd = new FormData()
  fd.set("personId", "7")
  fd.set("donorEmail", "g@x.com")
  fd.set("fyEndYear", "2025")
  fd.set("lines", JSON.stringify(lines))
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) fd.set(k, v)
  return fd
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.dgrReceipt.findFirst as jest.Mock).mockResolvedValue(null)
  // sendDgrReceipt claims the row via updateMany before rendering —
  // default to a winning claim (one row matched). Race tests override count: 0.
  ;(prisma.dgrReceipt.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
})

describe("createDgrReceipt", () => {
  it.each(["VIEWER", "AUDITOR", "OFFICE_ADMIN"])("rejects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    const res = await createDgrReceipt(undefined, formDataWithLines())
    expect(res).toEqual({ error: "Unauthorized" })
    expect(prisma.dgrReceipt.create).not.toHaveBeenCalled()
  })

  it("rejects empty lines", async () => {
    const res = await createDgrReceipt(undefined, formDataWithLines({}, []))
    expect(res).toEqual({ error: expect.any(String) })
    expect(prisma.dgrReceipt.create).not.toHaveBeenCalled()
  })

  it("rejects a negative amount", async () => {
    const res = await createDgrReceipt(
      undefined,
      formDataWithLines({}, [{ date: "2024-07-24", amount: -5, method: "Cash" }])
    )
    expect(res).toEqual({ error: expect.any(String) })
    expect(prisma.dgrReceipt.create).not.toHaveBeenCalled()
  })

  // unlike every other money field in the codebase, the DGR line amount
  // had no 2-decimal-place restriction — a sub-cent value could make the PDF
  // line total (rendered via toFixed(2)) diverge from the persisted receipt total.
  it("rejects a line amount with more than 2 decimal places", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: null } })
    const res = await createDgrReceipt(
      undefined,
      formDataWithLines({}, [{ date: "2024-07-24", amount: 100.005, method: "Cash" }])
    )
    expect(res).toEqual({ error: expect.stringMatching(/decimal/i) })
    expect(prisma.dgrReceipt.create).not.toHaveBeenCalled()
  })

  // LineSchema only checks YYYY-MM-DD format — a gift dated in another
  // FY would make the receipt PDF ("gifts received between 1 Jul … and 30 Jun
  // …") a false ATO deductible-gift receipt. FY range is enforced in parseForm.
  it("rejects a donation line dated outside the receipt's financial year", async () => {
    // fyEndYear 2025 → window 1 Jul 2024 – 30 Jun 2025; 2025-07-01 is next FY.
    const res = await createDgrReceipt(
      undefined,
      formDataWithLines({}, [{ date: "2025-07-01", amount: 100, method: "Cash" }])
    )
    expect(res).toEqual({ error: expect.stringMatching(/financial year/i) })
    expect(prisma.dgrReceipt.create).not.toHaveBeenCalled()
  })

  it("reports the configured financial-year bounds in validation errors", async () => {
    const previous = process.env.APP_FY_START_MONTH
    process.env.APP_FY_START_MONTH = "1"
    jest.resetModules()

    try {
      const { auth: freshAuth } = require("@/auth") as { auth: jest.Mock }
      freshAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
      const { createDgrReceipt: createWithCalendarYear } = require("@/lib/actions/dgrReceipt") as typeof import("@/lib/actions/dgrReceipt")

      const res = await createWithCalendarYear(
        undefined,
        formDataWithLines({ fyEndYear: "2026" }, [
          { date: "2027-01-01", amount: 100, method: "Cash" },
        ])
      )

      expect(res).toEqual({
        error: expect.stringContaining("1 January 2026 – 31 December 2026"),
      })
    } finally {
      if (previous === undefined) delete process.env.APP_FY_START_MONTH
      else process.env.APP_FY_START_MONTH = previous
      jest.resetModules()
    }
  })

  // LineSchema's regex alone accepts 2025-02-30, which JS normalises to
  // 2 Mar and prints verbatim on the tax receipt.
  it("rejects an impossible calendar date that passes the format regex", async () => {
    const res = await createDgrReceipt(
      undefined,
      formDataWithLines({}, [{ date: "2025-02-30", amount: 100, method: "Cash" }])
    )
    expect(res).toEqual({ error: expect.stringMatching(/calendar date/i) })
    expect(prisma.dgrReceipt.create).not.toHaveBeenCalled()
  })

  it("accepts donation lines on the FY boundary dates (1 Jul / 30 Jun)", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: null } })
    ;(prisma.dgrReceipt.create as jest.Mock).mockResolvedValue({ id: 21 })
    const res = await createDgrReceipt(
      undefined,
      formDataWithLines({}, [
        { date: "2024-07-01", amount: 10, method: "Cash" },
        { date: "2025-06-30", amount: 20, method: "Cash" },
      ])
    )
    expect(res).toBeUndefined()
    expect(prisma.dgrReceipt.create).toHaveBeenCalled()
  })

  it("accepts a line amount with exactly 2 decimal places", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: null } })
    ;(prisma.dgrReceipt.create as jest.Mock).mockResolvedValue({ id: 20 })
    const res = await createDgrReceipt(
      undefined,
      formDataWithLines({}, [{ date: "2024-07-24", amount: 100.5, method: "Cash" }])
    )
    expect(res).toBeUndefined()
    expect(prisma.dgrReceipt.create).toHaveBeenCalled()
  })

  it.each([
    ["a malformed address", "not-an-email"],
    ["a local part over 64 characters (SMTP limit)", `${"a".repeat(65)}@example.com`],
  ])("rejects a donor email with %s", async (_name, donorEmail) => {
    const res = await createDgrReceipt(undefined, formDataWithLines({ donorEmail }))
    expect(res).toEqual({ error: "Invalid email address" })
    expect(prisma.dgrReceipt.create).not.toHaveBeenCalled()
  })

  it("rejects a missing donor", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.dgrReceipt.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: null } })
    const res = await createDgrReceipt(undefined, formDataWithLines())
    expect(res).toEqual({ error: expect.any(String) })
    expect(prisma.dgrReceipt.create).not.toHaveBeenCalled()
  })

  it("blocks a second receipt for the same donor + financial year", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.findFirst as jest.Mock).mockResolvedValue({ receiptNo: "DGR-2025-001" })
    const res = await createDgrReceipt(undefined, formDataWithLines())
    expect(res).toEqual({ error: expect.stringContaining("DGR-2025-001") })
    expect(prisma.dgrReceipt.create).not.toHaveBeenCalled()
  })

  it("concurrent create for the same donor and FY yields one receipt", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: 2 } })
    // The racing request committed between our read and our write: Postgres aborts
    // our Serializable transaction (P2034); the retry re-reads and sees the winner's row.
    ;(prisma.dgrReceipt.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ receiptNo: "DGR-2025-003" })
    ;(prisma.$transaction as jest.Mock)
      .mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
        await fn(prisma)
        throw Object.assign(new Error("serialization failure"), { code: "P2034" })
      })
      .mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))

    const res = await createDgrReceipt(undefined, formDataWithLines())

    expect(res).toEqual({ error: expect.stringContaining("DGR-2025-003") })
    // The duplicate check and the insert share one Serializable transaction.
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
    expect(prisma.dgrReceipt.findFirst).toHaveBeenCalledTimes(2)
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("reports a just-created receipt when every create attempt hits a serialization conflict", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.$transaction as jest.Mock).mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" })
    )
    const res = await createDgrReceipt(undefined, formDataWithLines())
    expect(res).toEqual({ error: expect.stringMatching(/receipt for this donor and year was just created/i) })
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("assigns next per-FY sequence, encrypts email, snapshots donor name, and audits", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: 2 } })
    ;(prisma.dgrReceipt.create as jest.Mock).mockResolvedValue({ id: 10 })

    await createDgrReceipt(undefined, formDataWithLines())

    expect(prisma.dgrReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          seq: 3,
          receiptNo: "DGR-2025-003",
          fyEndYear: 2025,
          personId: 7,
          donorName: "Alex Sample",
          donorEmail: "enc:g@x.com",
          totalAmount: "100.00",
          status: "DRAFT",
        }),
      })
    )
    expect(mockLogAuditTx).toHaveBeenCalledWith(
      prisma,
      1,
      "DGR_RECEIPT_CREATED",
      "DgrReceipt",
      10,
      expect.objectContaining({ receiptNo: "DGR-2025-003", fyEndYear: 2025, personId: 7 })
    )
  })

  it("sums multiple lines into totalAmount as a fixed 2dp string", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: null } })
    ;(prisma.dgrReceipt.create as jest.Mock).mockResolvedValue({ id: 11 })

    await createDgrReceipt(
      undefined,
      formDataWithLines({}, [
        { date: "2024-07-24", amount: 50.5, method: "Cash" },
        { date: "2024-08-01", amount: 25.25, method: "Bank Transfer" },
      ])
    )

    expect(prisma.dgrReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seq: 1, totalAmount: "75.75" }) })
    )
  })

  it("returns AUDIT_FAILED_ERROR (no retry, no redirect) when the in-transaction audit write fails", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: 2 } })
    ;(prisma.dgrReceipt.create as jest.Mock).mockResolvedValue({ id: 10 })
    mockLogAuditTx.mockRejectedValueOnce(new Error("audit down"))
    expect(await createDgrReceipt(undefined, formDataWithLines())).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(prisma.dgrReceipt.create).toHaveBeenCalledTimes(1)
  })

  it("retries once on a unique-constraint race and succeeds", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.aggregate as jest.Mock)
      .mockResolvedValueOnce({ _max: { seq: 2 } })
      .mockResolvedValueOnce({ _max: { seq: 3 } })
    ;(prisma.dgrReceipt.create as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }))
      .mockResolvedValueOnce({ id: 12 })

    const res = await createDgrReceipt(undefined, formDataWithLines())

    expect(res).toBeUndefined()
    expect(prisma.dgrReceipt.create).toHaveBeenCalledTimes(2)
    expect(prisma.dgrReceipt.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seq: 4, receiptNo: "DGR-2025-004" }) })
    )
  })

  it("gives up after a second unique-constraint failure", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.aggregate as jest.Mock).mockResolvedValue({ _max: { seq: 2 } })
    ;(prisma.dgrReceipt.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error("Unique constraint"), { code: "P2002" })
    )

    const res = await createDgrReceipt(undefined, formDataWithLines())
    expect(res).toEqual({ error: expect.any(String) })
    expect(prisma.dgrReceipt.create).toHaveBeenCalledTimes(2)
  })
})

describe("updateDgrReceipt", () => {
  it("rejects non-accounting roles", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    const res = await updateDgrReceipt(1, undefined, formDataWithLines())
    expect(res).toEqual({ error: "Unauthorized" })
  })

  it("blocks editing once the receipt is SENT", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "SENT", fyEndYear: 2025 })
    const res = await updateDgrReceipt(1, undefined, formDataWithLines())
    expect(res).toEqual({ error: expect.any(String) })
    expect(prisma.dgrReceipt.update).not.toHaveBeenCalled()
    expect(prisma.dgrReceipt.updateMany).not.toHaveBeenCalled()
  })

  it("edit during SENDING is refused and does not reset status", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({
      id: 1, status: "SENDING", fyEndYear: 2025, personId: 7, sentAt: new Date(Date.now() - 60_000),
    })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    const res = await updateDgrReceipt(1, undefined, formDataWithLines())
    expect(res).toEqual({ error: expect.stringMatching(/being sent/i) })
    expect(prisma.dgrReceipt.update).not.toHaveBeenCalled()
    expect(prisma.dgrReceipt.updateMany).not.toHaveBeenCalled()
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("edit of a SENDING receipt whose send went stale recovers it to DRAFT", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({
      id: 1, status: "SENDING", fyEndYear: 2025, personId: 7, sentAt: new Date(Date.now() - 20 * 60_000),
    })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    const res = await updateDgrReceipt(1, undefined, formDataWithLines())
    expect(res).toBeUndefined()
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT", sentAt: null }) })
    )
  })

  it("edit that loses a race to a send is refused (status predicate matches no row)", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", fyEndYear: 2025, personId: 7 })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    const res = await updateDgrReceipt(1, undefined, formDataWithLines())
    expect(res).toEqual({ error: "This receipt is being sent or was sent" })
    const call = (prisma.dgrReceipt.updateMany as jest.Mock).mock.calls[0][0]
    // Only DRAFT/FAILED, or a stale SENDING, may be overwritten.
    expect(call.where).toEqual({
      id: 1,
      OR: [
        { status: { in: ["DRAFT", "FAILED"] } },
        { status: "SENDING", OR: [{ sentAt: null }, { sentAt: { lt: expect.any(Date) } }] },
      ],
    })
    expect(prisma.dgrReceipt.update).not.toHaveBeenCalled()
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("returns not-found for a missing receipt", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(null)
    const res = await updateDgrReceipt(999, undefined, formDataWithLines())
    expect(res).toEqual({ error: expect.any(String) })
  })

  // parseForm validates lines against the SUBMITTED fyEndYear; a crafted
  // edit sending a different year would smuggle a next-FY gift into this receipt.
  it("rejects an edit whose submitted financial year differs from the receipt's", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", fyEndYear: 2025, personId: 7 })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    // The attack: a line dated in FY2026 (1 Jul 2025) passes parseForm against
    // the submitted year 2026, but the receipt itself is FY2025.
    const res = await updateDgrReceipt(
      1,
      undefined,
      formDataWithLines({ fyEndYear: "2026" }, [{ date: "2025-07-01", amount: 100, method: "Cash" }])
    )
    expect(res).toEqual({ error: expect.stringMatching(/financial year cannot be changed/i) })
    expect(prisma.dgrReceipt.updateMany).not.toHaveBeenCalled()
  })

  // editing a receipt's donor must honour one-per-donor-per-FY (create's
  // rule) or two sendable receipts result.
  it("blocks re-pointing a receipt at a donor who already has one for the FY", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", fyEndYear: 2025, personId: 7 })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 8, firstName: "Anna", lastName: "Taylor" })
    ;(prisma.dgrReceipt.findFirst as jest.Mock).mockResolvedValue({ receiptNo: "DGR-2025-009" })
    const res = await updateDgrReceipt(1, undefined, formDataWithLines({ personId: "8" }))
    expect(res).toEqual({ error: expect.stringContaining("DGR-2025-009") })
    expect(prisma.dgrReceipt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { personId: 8, fyEndYear: 2025, id: { not: 1 } } })
    )
    expect(prisma.dgrReceipt.updateMany).not.toHaveBeenCalled()
  })

  // Editing without changing the donor must NOT run the dup check against itself.
  it("does not run the donor-dup check when the donor is unchanged", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", fyEndYear: 2025, personId: 7 })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    await updateDgrReceipt(1, undefined, formDataWithLines({ personId: "7" }))
    expect(prisma.dgrReceipt.findFirst).not.toHaveBeenCalled()
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalled()
  })

  it("updates a DRAFT receipt's donor, email, and lines", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", fyEndYear: 2025 })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 8, firstName: "Anna", lastName: "Taylor" })

    await updateDgrReceipt(
      1,
      undefined,
      formDataWithLines({ personId: "8", donorEmail: "anu@x.com" })
    )

    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 1 }),
        data: expect.objectContaining({
          personId: 8,
          donorName: "Anna Taylor",
          donorEmail: "enc:anu@x.com",
          totalAmount: "100.00",
        }),
      })
    )
    expect(mockLogAuditTx).toHaveBeenCalledWith(prisma, 1, "DGR_RECEIPT_UPDATED", "DgrReceipt", 1, expect.anything())
  })

  it("returns AUDIT_FAILED_ERROR when the in-transaction audit write fails", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", fyEndYear: 2025 })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 8, firstName: "Anna", lastName: "Taylor" })
    mockLogAuditTx.mockRejectedValueOnce(new Error("audit down"))
    expect(await updateDgrReceipt(1, undefined, formDataWithLines({ personId: "8" }))).toEqual({ error: AUDIT_FAILED_ERROR })
  })
})

describe("deleteDgrReceipt", () => {
  it("rejects non-accounting roles", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    const res = await deleteDgrReceipt(1)
    expect(res).toEqual({ error: "Unauthorized" })
  })

  it("blocks deleting a SENT receipt", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "SENT", receiptNo: "DGR-2025-001" })
    const res = await deleteDgrReceipt(1)
    expect(res).toEqual({ error: expect.any(String) })
    expect(prisma.dgrReceipt.delete).not.toHaveBeenCalled()
    expect(prisma.dgrReceipt.deleteMany).not.toHaveBeenCalled()
  })

  it.each([
    ["SENDING", new Date()],
    ["SENDING", new Date(Date.now() - 60 * 60_000)],
    ["UNKNOWN", new Date()],
  ])("delete of a %s receipt is refused", async (status, sentAt) => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status, sentAt, receiptNo: "DGR-2025-001" })
    const res = await deleteDgrReceipt(1)
    expect(res).toEqual({ error: expect.any(String) })
    expect(prisma.dgrReceipt.delete).not.toHaveBeenCalled()
    expect(prisma.dgrReceipt.deleteMany).not.toHaveBeenCalled()
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("delete that loses a race to a send is refused (status predicate matches no row)", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", receiptNo: "DGR-2025-001" })
    ;(prisma.dgrReceipt.deleteMany as jest.Mock).mockResolvedValue({ count: 0 })
    const res = await deleteDgrReceipt(1)
    expect(res).toEqual({ error: expect.any(String) })
    expect(prisma.dgrReceipt.deleteMany).toHaveBeenCalledWith({ where: { id: 1, status: { in: ["DRAFT", "FAILED"] } } })
    expect(prisma.dgrReceipt.delete).not.toHaveBeenCalled()
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("deletes a DRAFT receipt and audits", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", receiptNo: "DGR-2025-001" })
    ;(prisma.dgrReceipt.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })
    const res = await deleteDgrReceipt(1)
    expect(res).toEqual({ success: expect.any(String) })
    expect(mockLogAuditTx).toHaveBeenCalledWith(prisma, 1, "DGR_RECEIPT_DELETED", "DgrReceipt", 1, expect.anything())
  })

  it("returns AUDIT_FAILED_ERROR when the in-transaction audit write fails", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", receiptNo: "DGR-2025-001" })
    mockLogAuditTx.mockRejectedValueOnce(new Error("audit down"))
    expect(await deleteDgrReceipt(1)).toEqual({ error: AUDIT_FAILED_ERROR })
  })
})

describe("sendDgrReceipt", () => {
  const draftReceipt = {
    id: 5,
    receiptNo: "DGR-2025-003",
    fyEndYear: 2025,
    seq: 3,
    personId: 7,
    donorName: "Alex Sample",
    donorEmail: "enc:g@x.com",
    lines: [{ date: "2024-07-24", amount: 100, method: "Bank Transfer" }],
    totalAmount: "100.00",
    status: "DRAFT",
    createdAt: new Date("2025-07-08T00:00:00Z"),
    createdById: 1,
  }

  it("rejects non-accounting roles", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const res = await sendDgrReceipt(5)
    expect(res).toEqual({ error: "Unauthorized" })
  })

  it("issue date is the Sydney send date, not the UTC createdAt day", async () => {
    jest.useFakeTimers({ now: new Date("2026-06-30T14:30:00Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout"] }) // 1 July 00:30 Sydney
    try {
      ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
      mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
      mockSendEmail.mockResolvedValue(undefined)
      await sendDgrReceipt(5)
      expect(mockRenderPdf).toHaveBeenCalledWith(expect.objectContaining({ issueDate: "1 July 2026" }))
      expect(mockSendEmail).toHaveBeenCalledWith(
        "g@x.com",
        expect.anything(),
        expect.objectContaining({ issueDate: "1 July 2026" })
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it("freezes the issuer snapshot and the encrypted emailed PDF on the SENT update", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockResolvedValue(undefined)
    await sendDgrReceipt(5)
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, status: "SENDING", sentAt: expect.any(Date) },
        data: expect.objectContaining({
          status: "SENT",
          frozenPdf: Buffer.from(`enc:${Buffer.from("pdf").toString("base64")}`),
          issuer: expect.objectContaining({
            churchName: "Example Church",
            churchAbn: "51824753556",
            legalLines: ["Test legal text"],
          }),
        }),
      })
    )
  })

  it("renders the PDF, emails it, marks SENT, and audits on success", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockResolvedValue(undefined)

    const res = await sendDgrReceipt(5)

    expect(mockRenderPdf).toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalledWith(
      "g@x.com",
      Buffer.from("pdf"),
      expect.objectContaining({ receiptNo: "DGR-2025-003" })
    )
    // Claimed the row (DRAFT/FAILED → SENDING) before rendering…
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, status: "DRAFT" },
        data: expect.objectContaining({ status: "SENDING", sentAt: expect.any(Date) }),
      })
    )
    // …then finalised SENT only from the claimed SENDING state.
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, status: "SENDING", sentAt: expect.any(Date) },
        data: expect.objectContaining({ status: "SENT", sentAt: expect.any(Date), sentById: 1 }),
      })
    )
    expect(mockLogAudit).toHaveBeenCalledWith(1, "DGR_RECEIPT_SENT", "DgrReceipt", 5, { receiptNo: "DGR-2025-003" })
    expect(res).toEqual({ success: expect.any(String) })
  })

  it("marks FAILED, audits DGR_RECEIPT_FAILED, and returns an error (never throws) when email send fails", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockRejectedValue(new Error("SMTP 552 blocked: g@x.com over quota"))

    const res = await sendDgrReceipt(5)

    expect(res).toEqual({ error: expect.any(String) })
    // FAILED written only from the claimed SENDING state, so a losing parallel
    // send can never clobber a SENT.
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, status: "SENDING", sentAt: expect.any(Date) },
        data: expect.objectContaining({ status: "FAILED", errorMessage: expect.any(String) }),
      })
    )
    // Never log the raw error (it can embed the recipient email).
    expect(mockLogAudit).toHaveBeenCalledWith(1, "DGR_RECEIPT_FAILED", "DgrReceipt", 5, { receiptNo: "DGR-2025-003" })
  })

  it.each(["ETIMEDOUT", "ECONNRESET"])(
    "ambiguous SMTP error (%s) does not leave the receipt editable or deletable",
    async (code) => {
      ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
      mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
      mockSendEmail.mockRejectedValue(Object.assign(new Error("socket hang up"), { code }))

      const res = await sendDgrReceipt(5)

      expect(res).toEqual({ error: expect.stringMatching(/may have been delivered.*check before resending/i) })
      // Recorded as UNKNOWN (possibly delivered), never FAILED.
      expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5, status: "SENDING", sentAt: expect.any(Date) },
          data: expect.objectContaining({ status: "UNKNOWN" }),
        })
      )
      expect(prisma.dgrReceipt.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
      )
      expect(mockLogAudit).toHaveBeenCalledWith(1, "DGR_RECEIPT_FAILED", "DgrReceipt", 5, {
        receiptNo: "DGR-2025-003",
        outcome: "unknown",
      })

      // The possibly-delivered row now refuses edit and delete.
      jest.clearAllMocks()
      const unknownRow = { ...draftReceipt, status: "UNKNOWN", sentAt: new Date(), errorMessage: "x" }
      ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(unknownRow)
      ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
      expect(await updateDgrReceipt(5, undefined, formDataWithLines())).toEqual({ error: expect.any(String) })
      expect(await deleteDgrReceipt(5)).toEqual({ error: expect.any(String) })
      expect(prisma.dgrReceipt.update).not.toHaveBeenCalled()
      expect(prisma.dgrReceipt.updateMany).not.toHaveBeenCalled()
      expect(prisma.dgrReceipt.delete).not.toHaveBeenCalled()
      expect(prisma.dgrReceipt.deleteMany).not.toHaveBeenCalled()
    }
  )

  it("a definite SMTP failure (ECONNREFUSED) marks FAILED and clears the attempt time", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockRejectedValue(Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }))
    const res = await sendDgrReceipt(5)
    expect(res).toEqual({ error: expect.stringMatching(/marked failed/i) })
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, status: "SENDING", sentAt: expect.any(Date) },
        data: expect.objectContaining({ status: "FAILED", sentAt: null }),
      })
    )
  })

  it("still marks FAILED and returns the could-not-email error when the best-effort audit write fails (row never wedged in SENDING)", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockRejectedValue(new Error("SMTP down"))
    // Real logAudit swallows insert errors and resolves false; model that contract.
    mockLogAudit.mockResolvedValueOnce(false)
    const res = await sendDgrReceipt(5)
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, status: "SENDING", sentAt: expect.any(Date) }, data: expect.objectContaining({ status: "FAILED" }) })
    )
    expect(mockLogAudit).toHaveBeenCalledWith(1, "DGR_RECEIPT_FAILED", "DgrReceipt", 5, { receiptNo: "DGR-2025-003" })
    expect(res).toEqual({ error: expect.stringMatching(/marked failed/i) })
    expect(mockLogAuditTx).not.toHaveBeenCalled()
  })

  /**
   * Helper-level variant of the test above: runs the REAL logAudit with
   * auditLog.create rejecting, instead of mocking the helper's resolved-false contract.
   */
  it("still marks FAILED and returns the could-not-email error when the real logAudit's auditLog.create rejects", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockRejectedValue(new Error("SMTP down"))
    // clearAllMocks keeps queued once-values from earlier tests; drop them so the real helper is what runs.
    mockLogAudit.mockReset()
    mockLogAudit.mockImplementationOnce(realLogAudit)
    ;(prisma.auditLog.create as jest.Mock).mockRejectedValueOnce(new Error("audit db down"))
    const res = await sendDgrReceipt(5)
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, status: "SENDING", sentAt: expect.any(Date) }, data: expect.objectContaining({ status: "FAILED" }) })
    )
    expect(res).toEqual({ error: expect.stringMatching(/marked failed/i) })
  })

  it("a definite failure on a resend of an UNKNOWN receipt keeps it UNKNOWN (still frozen)", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ ...draftReceipt, status: "UNKNOWN", sentAt: new Date() })
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockRejectedValue(Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }))
    const res = await sendDgrReceipt(5)
    expect(res).toEqual({ error: expect.stringMatching(/earlier attempt may have been delivered/i) })
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, status: "SENDING", sentAt: expect.any(Date) }, data: expect.objectContaining({ status: "UNKNOWN" }) })
    )
    expect(prisma.dgrReceipt.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    )
  })

  it("keeps the first document when delivery ends UNKNOWN: persists issuer + encrypted PDF", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
    await sendDgrReceipt(5)
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, status: "SENDING", sentAt: expect.any(Date) },
        data: expect.objectContaining({
          status: "UNKNOWN",
          frozenPdf: Buffer.from(`enc:${Buffer.from("pdf").toString("base64")}`),
          issuer: expect.objectContaining({ churchName: "Example Church", issueDate: expect.any(String) }),
        }),
      })
    )
  })

  it("an UNKNOWN retry reuses the stored PDF and issue date instead of re-rendering", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-22T00:00:00Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout"] })
    try {
      ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({
        ...draftReceipt,
        status: "UNKNOWN",
        sentAt: new Date(),
        frozenPdf: Buffer.from(`enc:${Buffer.from("first-pdf").toString("base64")}`),
        issuer: {
          churchName: "Old Church",
          churchAbn: "11111111111",
          churchAddress: "Old addr",
          churchEmail: "old@example.com",
          documentTitle: "OLD TITLE",
          totalDonationsLabel: "OLD TOTAL",
          legalLines: ["Old legal"],
          coveredPeriod: "old period",
          issueDate: "21 November 2026",
        },
      })
      mockSendEmail.mockResolvedValue(undefined)
      await sendDgrReceipt(5)
      expect(mockRenderPdf).not.toHaveBeenCalled()
      expect(mockSendEmail).toHaveBeenCalledWith(
        "g@x.com",
        Buffer.from("first-pdf"),
        expect.objectContaining({ issueDate: "21 November 2026", churchName: "Old Church" })
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it("an UNKNOWN retry with an unreadable stored PDF re-renders with the first issue date", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-22T00:00:00Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout"] })
    try {
      ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({
        ...draftReceipt,
        status: "UNKNOWN",
        sentAt: new Date(),
        frozenPdf: null,
        issuer: {
          churchName: "Old Church",
          churchAbn: "11111111111",
          churchAddress: "Old addr",
          churchEmail: "old@example.com",
          documentTitle: "OLD TITLE",
          totalDonationsLabel: "OLD TOTAL",
          legalLines: ["Old legal"],
          coveredPeriod: "old period",
          issueDate: "21 November 2026",
        },
      })
      mockRenderPdf.mockResolvedValue(Buffer.from("re-rendered"))
      mockSendEmail.mockResolvedValue(undefined)
      await sendDgrReceipt(5)
      expect(mockRenderPdf).toHaveBeenCalledWith(expect.objectContaining({ issueDate: "21 November 2026" }))
    } finally {
      jest.useRealTimers()
    }
  })

  it("a stale send cannot finalize a row that a newer claim now holds (SENT write is scoped to its claim)", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockResolvedValue(undefined)
    await sendDgrReceipt(5)
    const calls = (prisma.dgrReceipt.updateMany as jest.Mock).mock.calls.map((c) => c[0])
    const claim = calls[0]
    const sent = calls.find((c) => c.data.status === "SENT")
    expect(sent.where.sentAt).toEqual(claim.data.sentAt)
  })

  it("claims only the status its document was built from, and refuses a row already SENDING", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ ...draftReceipt, status: "SENDING" })
    expect(await sendDgrReceipt(5)).toEqual({ error: expect.stringMatching(/already being sent/i) })
    expect(prisma.dgrReceipt.updateMany).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("does not report success when the SENT write matches no row", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    mockRenderPdf.mockResolvedValue(Buffer.from("pdf"))
    mockSendEmail.mockResolvedValue(undefined)
    ;(prisma.dgrReceipt.updateMany as jest.Mock)
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }) // SENT write lost the row
    const res = await sendDgrReceipt(5)
    expect(res).toEqual({ error: expect.stringMatching(/status could not be updated/i) })
  })

  it("rejects a concurrent send whose claim loses the race, without emailing", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(draftReceipt)
    ;(prisma.dgrReceipt.updateMany as jest.Mock).mockResolvedValue({ count: 0 }) // no claimable row
    const res = await sendDgrReceipt(5)
    expect(res).toEqual({ error: expect.stringMatching(/already being sent|already been sent/i) })
    expect(mockRenderPdf).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("returns not-found for a missing receipt", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(null)
    const res = await sendDgrReceipt(999)
    expect(res).toEqual({ error: expect.any(String) })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  // a SENT receipt is a legal ATO tax receipt already delivered — a
  // double-click or retry must never re-email the donor or overwrite sentAt/sentById.
  it("blocks re-sending an already-SENT receipt", async () => {
    const sentReceipt = { ...draftReceipt, status: "SENT", sentAt: new Date("2025-07-08T01:00:00Z"), sentById: 9 }
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(sentReceipt)

    const res = await sendDgrReceipt(5)

    expect(res).toEqual({ error: expect.any(String) })
    expect(mockRenderPdf).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(prisma.dgrReceipt.update).not.toHaveBeenCalled()
    expect(mockLogAudit).not.toHaveBeenCalled()
  })
})

describe("getDonorEmail", () => {
  it("rejects non-accounting roles", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    expect(await getDonorEmail(7)).toEqual({ error: "Unauthorized" })
    expect(prisma.person.findUnique).not.toHaveBeenCalled()
  })

  it("returns the decrypted email for an accounting editor", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ email: "enc:g@x.com" })
    expect(await getDonorEmail(7)).toEqual({ email: "g@x.com" })
  })

  it("returns null when the person has no email", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ email: null })
    expect(await getDonorEmail(7)).toEqual({ email: null })
  })
})

describe("listDgrReceipts", () => {
  it("rejects roles without accounting view access", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    const res = await listDgrReceipts()
    expect(res).toEqual({ error: "Unauthorized" })
  })

  it("allows AUDITOR (read-only) and returns mapped rows", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    ;(prisma.dgrReceipt.findMany as jest.Mock).mockResolvedValue([
      {
        id: 5,
        receiptNo: "DGR-2025-003",
        fyEndYear: 2025,
        donorName: "Alex Sample",
        totalAmount: { toString: () => "100.00" },
        status: "SENT",
        sentAt: new Date("2025-07-08T00:00:00Z"),
      },
    ])

    const res = await listDgrReceipts(2025)

    expect(Array.isArray(res)).toBe(true)
    expect(res).toEqual([
      expect.objectContaining({
        id: 5,
        receiptNo: "DGR-2025-003",
        fyLabel: "2024–25",
        donorName: "Alex Sample",
        total: 100,
        status: "SENT",
      }),
    ])
    expect(prisma.dgrReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fyEndYear: 2025 } })
    )
  })

  it("caps the all-years query with a bounded take (no unbounded full-table load)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    ;(prisma.dgrReceipt.findMany as jest.Mock).mockResolvedValue([])

    await listDgrReceipts()

    const arg = (prisma.dgrReceipt.findMany as jest.Mock).mock.calls[0][0]
    expect(arg.where).toEqual({})
    expect(typeof arg.take).toBe("number")
    expect(arg.take).toBeGreaterThan(0)
  })
})
