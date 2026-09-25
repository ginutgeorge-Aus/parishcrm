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
import { logAudit } from "@/lib/audit"
import { sendDgrReceiptEmail } from "@/lib/email"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/email", () => ({ sendDgrReceiptEmail: jest.fn() }))
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
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

const mockAuth = auth as jest.Mock
const mockLogAudit = logAudit as jest.Mock
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
    expect(mockLogAudit).toHaveBeenCalledWith(
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
    expect(prisma.dgrReceipt.update).not.toHaveBeenCalled()
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
    expect(prisma.dgrReceipt.update).not.toHaveBeenCalled()
  })

  // Editing without changing the donor must NOT run the dup check against itself.
  it("does not run the donor-dup check when the donor is unchanged", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", fyEndYear: 2025, personId: 7 })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 7, firstName: "Alex", lastName: "Sample" })
    ;(prisma.dgrReceipt.update as jest.Mock).mockResolvedValue({ id: 1 })
    await updateDgrReceipt(1, undefined, formDataWithLines({ personId: "7" }))
    expect(prisma.dgrReceipt.findFirst).not.toHaveBeenCalled()
    expect(prisma.dgrReceipt.update).toHaveBeenCalled()
  })

  it("updates a DRAFT receipt's donor, email, and lines", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", fyEndYear: 2025 })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 8, firstName: "Anna", lastName: "Taylor" })
    ;(prisma.dgrReceipt.update as jest.Mock).mockResolvedValue({ id: 1 })

    await updateDgrReceipt(
      1,
      undefined,
      formDataWithLines({ personId: "8", donorEmail: "anu@x.com" })
    )

    expect(prisma.dgrReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          personId: 8,
          donorName: "Anna Taylor",
          donorEmail: "enc:anu@x.com",
          totalAmount: "100.00",
        }),
      })
    )
    expect(mockLogAudit).toHaveBeenCalledWith(1, "DGR_RECEIPT_UPDATED", "DgrReceipt", 1, expect.anything())
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
  })

  it("deletes a DRAFT receipt and audits", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "DRAFT", receiptNo: "DGR-2025-001" })
    ;(prisma.dgrReceipt.delete as jest.Mock).mockResolvedValue({ id: 1 })
    const res = await deleteDgrReceipt(1)
    expect(res).toEqual({ success: expect.any(String) })
    expect(mockLogAudit).toHaveBeenCalledWith(1, "DGR_RECEIPT_DELETED", "DgrReceipt", 1, expect.anything())
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
        where: { id: 5, status: { in: ["DRAFT", "FAILED"] } },
        data: expect.objectContaining({ status: "SENDING" }),
      })
    )
    // …then finalised SENT only from the claimed SENDING state.
    expect(prisma.dgrReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, status: "SENDING" },
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
        where: { id: 5, status: "SENDING" },
        data: expect.objectContaining({ status: "FAILED", errorMessage: expect.any(String) }),
      })
    )
    // Never log the raw error (it can embed the recipient email).
    expect(mockLogAudit).toHaveBeenCalledWith(1, "DGR_RECEIPT_FAILED", "DgrReceipt", 5, { receiptNo: "DGR-2025-003" })
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
