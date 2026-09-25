/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findUnique: jest.fn(), findMany: jest.fn() },
    receiptSend: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    appSetting: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))
jest.mock("@/lib/email", () => ({ sendReceiptEmail: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { sendReceiptEmail } from "@/lib/email"
import { sendSingleReceipt, sendBatchReceipts, fetchTransactionsForReceipt } from "@/lib/actions/receipt"

const mockSession = auth as jest.Mock
const mockFindUnique = prisma.transaction.findUnique as jest.Mock
const mockFindMany = prisma.transaction.findMany as jest.Mock
const mockReceiptCreate = prisma.receiptSend.create as jest.Mock
const mockReceiptCreateMany = prisma.receiptSend.createMany as jest.Mock
const mockReceiptFindMany = prisma.receiptSend.findMany as jest.Mock
const mockSendEmail = sendReceiptEmail as jest.Mock

const adminSession = { user: { role: "ADMIN", id: "1" } }
const pastorSession = { user: { role: "PASTOR", id: "2" } }
const viewerSession = { user: { role: "VIEWER", id: "3" } }

const mockTransaction = {
  id: 10,
  date: new Date("2026-05-15"),
  description: "Sunday Offering",
  amount: { toString: () => "500.00" },
  type: "INCOME",
  account: { code: "4001", name: "Sunday Offering" },
  family: { name: "Smith" },
  person: null,
  reference: null,
  notes: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CHURCH_NAME = "Example Church"
  process.env.CHURCH_ADDRESS = "123 Example St"
  process.env.CHURCH_ABN = "12 345 678 901"
  process.env.GMAIL_USER = "church@gmail.com"
})

// --- sendSingleReceipt ---
describe("sendSingleReceipt", () => {
  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue(viewerSession)
    const result = await sendSingleReceipt(10, "test@example.com")
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("blocks AUDITOR", async () => {
    mockSession.mockResolvedValue({ user: { role: "AUDITOR", id: "4" } })
    const result = await sendSingleReceipt(10, "test@example.com")
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await sendSingleReceipt(10, "test@example.com")
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error for invalid email", async () => {
    mockSession.mockResolvedValue(adminSession)
    const result = await sendSingleReceipt(10, "not-an-email")
    expect(result).toEqual({ error: "Invalid email address" })
  })

  it("returns error when transaction not found", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue(null)
    const result = await sendSingleReceipt(10, "test@example.com")
    expect(result).toEqual({ error: "Transaction not found" })
    expect(mockReceiptCreate).not.toHaveBeenCalled()
  })

  it("sends email and creates SUCCESS ReceiptSend for ADMIN", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue(mockTransaction)
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendSingleReceipt(10, "test@example.com")
    expect(mockSendEmail).toHaveBeenCalled()
    expect(mockReceiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: 10,
        sentTo: "enc:test@example.com",
        sentById: 1,
        status: "SUCCESS",
      }),
    })
    expect(result).toEqual({ success: "Receipt sent to test@example.com" })
  })

  it("allows PASTOR role", async () => {
    mockSession.mockResolvedValue(pastorSession)
    mockFindUnique.mockResolvedValue(mockTransaction)
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendSingleReceipt(10, "test@example.com")
    expect(result).toEqual({ success: "Receipt sent to test@example.com" })
  })

  it("formats the receipt amount to 2dp without a float round-trip", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue(mockTransaction)
    mockSendEmail.mockResolvedValue(undefined)
    await sendSingleReceipt(10, "test@example.com")
    expect(mockSendEmail.mock.calls[0][1]).toEqual(
      expect.objectContaining({ amount: "$500.00" })
    )
  })

  it("pads a whole-dollar Decimal to 2dp", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue({ ...mockTransaction, amount: { toString: () => "500" } })
    mockSendEmail.mockResolvedValue(undefined)
    await sendSingleReceipt(10, "test@example.com")
    expect(mockSendEmail.mock.calls[0][1]).toEqual(
      expect.objectContaining({ amount: "$500.00" })
    )
  })

  it("does not re-send when an identical receipt was sent seconds ago (debounce)", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue(mockTransaction)
    mockReceiptFindMany.mockResolvedValue([{ sentTo: "enc:test@example.com", sentAt: new Date() }])
    const result = await sendSingleReceipt(10, "test@example.com")
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockReceiptCreate).not.toHaveBeenCalled()
    expect(result).toEqual({ success: expect.stringContaining("test@example.com") })
  })

  it("still sends when the only recent send was to a different recipient", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue(mockTransaction)
    mockSendEmail.mockResolvedValue(undefined)
    mockReceiptFindMany.mockResolvedValue([{ sentTo: "enc:someone-else@example.com", sentAt: new Date() }])
    await sendSingleReceipt(10, "test@example.com")
    expect(mockSendEmail).toHaveBeenCalled()
    expect(mockReceiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sentTo: "enc:test@example.com", status: "SUCCESS" }),
    })
  })

  it("creates FAILED ReceiptSend when email throws", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue(mockTransaction)
    mockSendEmail.mockRejectedValue(new Error("Auth error"))
    const result = await sendSingleReceipt(10, "test@example.com")
    expect(mockReceiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sentTo: "enc:test@example.com",
        status: "FAILED",
        errorMessage: "Email delivery failed",
      }),
    })
    expect(result).toEqual({ error: "Email delivery failed" })
  })

  it("blocks sending to a person without email consent", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue({
      ...mockTransaction,
      person: { firstName: "Jane", lastName: "Doe", emailConsent: false },
    })
    const result = await sendSingleReceipt(10, "jane@example.com")
    expect(result).toEqual({ error: "Recipient has not consented to email receipts" })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockReceiptCreate).not.toHaveBeenCalled()
  })

  it("sends to a person with emailConsent=true", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue({
      ...mockTransaction,
      person: { firstName: "Jane", lastName: "Doe", emailConsent: true },
    })
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendSingleReceipt(10, "jane@example.com")
    expect(mockSendEmail).toHaveBeenCalled()
    expect(result).toEqual({ success: "Receipt sent to jane@example.com" })
  })

  it("blocks a family recipient matching an opted-out member", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue({
      ...mockTransaction,
      person: null,
      family: { name: "Smith", people: [{ email: "enc:jane@example.com", emailConsent: false }] },
    })
    const result = await sendSingleReceipt(10, "jane@example.com")
    expect(result).toEqual({ error: "Recipient has not consented to email receipts" })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockReceiptCreate).not.toHaveBeenCalled()
  })

  it("allows a manual override email not matching any opted-out family member", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue({
      ...mockTransaction,
      person: null,
      family: { name: "Smith", people: [{ email: "enc:jane@example.com", emailConsent: false }] },
    })
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendSingleReceipt(10, "treasurer@church.org")
    expect(mockSendEmail).toHaveBeenCalled()
    expect(result).toEqual({ success: "Receipt sent to treasurer@church.org" })
  })

  it("reports success, not a failure, when the SUCCESS audit row fails to persist after delivery", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue(mockTransaction)
    mockSendEmail.mockResolvedValue(undefined)
    mockReceiptCreate.mockRejectedValue(new Error("DB write error"))
    const result = await sendSingleReceipt(10, "test@example.com")
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockReceiptCreate).toHaveBeenCalledTimes(1)
    expect(mockReceiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "SUCCESS" }),
    })
    // The donor already received the email — a resend-inviting error would be wrong.
    expect(result).toEqual({ success: "Receipt sent to test@example.com" })
  })

  it("runs the debounce recheck before attempting delivery", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue(mockTransaction)
    mockSendEmail.mockResolvedValue(undefined)
    await sendSingleReceipt(10, "test@example.com")
    expect(mockReceiptFindMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendEmail.mock.invocationCallOrder[0]
    )
  })
})

// --- sendBatchReceipts ---
describe("sendBatchReceipts", () => {
  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue(viewerSession)
    const result = await sendBatchReceipts([{ transactionId: 1, toEmail: "a@b.com" }])
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks AUDITOR", async () => {
    mockSession.mockResolvedValue({ user: { role: "AUDITOR", id: "4" } })
    const result = await sendBatchReceipts([{ transactionId: 1, toEmail: "a@b.com" }])
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error when batch exceeds 200", async () => {
    mockSession.mockResolvedValue(adminSession)
    const rows = Array.from({ length: 201 }, (_, i) => ({ transactionId: i, toEmail: "a@b.com" }))
    const result = await sendBatchReceipts(rows)
    expect(result).toEqual({ error: "Max 200 per batch" })
  })

  it("returns sent/failed counts for successful batch", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([mockTransaction])
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendBatchReceipts([
      { transactionId: 10, toEmail: "a@b.com" },
      { transactionId: 10, toEmail: "b@b.com" },
    ])
    expect(result).toEqual({ sent: 2, failed: 0, errors: [] })
  })

  it("counts failures without throwing", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([mockTransaction])
    mockSendEmail
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("SMTP error"))
    const result = await sendBatchReceipts([
      { transactionId: 10, toEmail: "a@b.com" },
      { transactionId: 10, toEmail: "b@b.com" },
    ])
    expect(result).toEqual({
      sent: 1,
      failed: 1,
      errors: [{ transactionId: 10, error: "Email delivery failed" }],
    })
  })

  it("counts 'Transaction not found' when id absent from fetched set", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([])
    const result = await sendBatchReceipts([{ transactionId: 99, toEmail: "a@b.com" }])
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(result).toEqual({
      sent: 0,
      failed: 1,
      errors: [{ transactionId: 99, error: "Transaction not found" }],
    })
  })

  it("skips sending to person without email consent", async () => {
    mockSession.mockResolvedValue(adminSession)
    const txNoConsent = { ...mockTransaction, person: { firstName: "Jane", lastName: "Doe", emailConsent: false } }
    mockFindMany.mockResolvedValue([txNoConsent])
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendBatchReceipts([{ transactionId: 10, toEmail: "jane@example.com" }])
    expect(mockSendEmail).not.toHaveBeenCalled()
    // Consent skip is no longer silent: reported so the operator sees it.
    expect(result).toEqual({
      sent: 0,
      failed: 1,
      errors: [{ transactionId: 10, error: "Recipient has not consented to email receipts" }],
    })
  })

  it("sends when person has emailConsent=true", async () => {
    mockSession.mockResolvedValue(adminSession)
    const txConsent = { ...mockTransaction, person: { firstName: "Jane", lastName: "Doe", emailConsent: true } }
    mockFindMany.mockResolvedValue([txConsent])
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendBatchReceipts([{ transactionId: 10, toEmail: "jane@example.com" }])
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ sent: 1, failed: 0, errors: [] })
  })

  it("skips family receipt when matching member has emailConsent=false", async () => {
    mockSession.mockResolvedValue(adminSession)
    const txFamilyNoConsent = {
      ...mockTransaction,
      person: null,
      // enc: fixture so the consent match exercises the decrypt path
      family: { name: "Smith", people: [{ email: "enc:jane@example.com", emailConsent: false }] },
    }
    mockFindMany.mockResolvedValue([txFamilyNoConsent])
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendBatchReceipts([{ transactionId: 10, toEmail: "jane@example.com" }])
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(result).toEqual({
      sent: 0,
      failed: 1,
      errors: [{ transactionId: 10, error: "Recipient has not consented to email receipts" }],
    })
  })

  it("sends family receipt when matching member has emailConsent=true", async () => {
    mockSession.mockResolvedValue(adminSession)
    const txFamilyConsent = {
      ...mockTransaction,
      person: null,
      family: { name: "Smith", people: [{ email: "enc:jane@example.com", emailConsent: true }] },
    }
    mockFindMany.mockResolvedValue([txFamilyConsent])
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendBatchReceipts([{ transactionId: 10, toEmail: "jane@example.com" }])
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ sent: 1, failed: 0, errors: [] })
  })

  it("sends family receipt to manual override email not matching any member", async () => {
    mockSession.mockResolvedValue(adminSession)
    const txFamilyManual = {
      ...mockTransaction,
      person: null,
      family: { name: "Smith", people: [{ email: "jane@example.com", emailConsent: false }] },
    }
    mockFindMany.mockResolvedValue([txFamilyManual])
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendBatchReceipts([{ transactionId: 10, toEmail: "treasurer@church.org" }])
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ sent: 1, failed: 0, errors: [] })
  })

  it("batches reads (one findMany, no per-row findUnique) but writes each ReceiptSend per-row", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([
      { ...mockTransaction, id: 10 },
      { ...mockTransaction, id: 11 },
    ])
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendBatchReceipts([
      { transactionId: 10, toEmail: "a@b.com" },
      { transactionId: 11, toEmail: "b@b.com" },
    ])
    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [10, 11] } } })
    )
    expect(mockFindUnique).not.toHaveBeenCalled()
    // each receipt is persisted immediately after its send, not batched
    // after the loop — an interrupted batch must not lose delivery records.
    expect(mockReceiptCreateMany).not.toHaveBeenCalled()
    expect(mockReceiptCreate).toHaveBeenCalledTimes(2)
    const written = mockReceiptCreate.mock.calls.map((c) => c[0].data)
    expect(written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transactionId: 10, sentTo: "enc:a@b.com", sentById: 1, status: "SUCCESS" }),
        expect.objectContaining({ transactionId: 11, sentTo: "enc:b@b.com", sentById: 1, status: "SUCCESS" }),
      ])
    )
    expect(result).toEqual({ sent: 2, failed: 0, errors: [] })
  })

  it("does not abort the batch when a family member's email ciphertext is corrupt", async () => {
    mockSession.mockResolvedValue(adminSession)
    const txCorruptMember = {
      ...mockTransaction,
      person: null,
      family: { name: "Smith", people: [{ email: "enc:CORRUPT", emailConsent: false }] },
    }
    mockFindMany.mockResolvedValue([txCorruptMember])
    const { decrypt } = jest.requireMock("@/lib/crypto")
    ;(decrypt as jest.Mock).mockImplementation((v: string) => {
      if (v === "enc:CORRUPT") throw new Error("bad ciphertext")
      return v.replace(/^enc:/, "")
    })
    mockSendEmail.mockResolvedValue(undefined)
    // Corrupt member email can't be compared → no consent match → send proceeds.
    const result = await sendBatchReceipts([{ transactionId: 10, toEmail: "treasurer@church.org" }])
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ sent: 1, failed: 0, errors: [] })
  })

  it("continues the batch and still audits when a FAILED receiptSend write throws", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([
      { ...mockTransaction, id: 10 },
      { ...mockTransaction, id: 11 },
    ])
    mockSendEmail.mockRejectedValue(new Error("SMTP error"))
    // First failure-path create throws (DB error); second succeeds.
    mockReceiptCreate
      .mockRejectedValueOnce(new Error("DB write error"))
      .mockResolvedValueOnce(undefined)
    const result = await sendBatchReceipts([
      { transactionId: 10, toEmail: "a@b.com" },
      { transactionId: 11, toEmail: "b@b.com" },
    ])
    // Batch not aborted by the failed write — both rows processed and counted.
    expect("failed" in result && result.failed).toBe(2)
    expect(mockReceiptCreate).toHaveBeenCalledTimes(2)
    const { logAudit } = jest.requireMock("@/lib/audit")
    expect(logAudit).toHaveBeenCalled()
  })

  it("writes a FAILED receiptSend row immediately on email failure", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([mockTransaction])
    mockSendEmail.mockRejectedValue(new Error("SMTP error"))
    await sendBatchReceipts([{ transactionId: 10, toEmail: "a@b.com" }])
    expect(mockReceiptCreateMany).not.toHaveBeenCalled()
    expect(mockReceiptCreate).toHaveBeenCalledTimes(1)
    expect(mockReceiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: 10,
        sentTo: "enc:a@b.com",
        sentById: 1,
        status: "FAILED",
        errorMessage: "Email delivery failed",
      }),
    })
  })

  it("dedups an exact-duplicate (transactionId, toEmail) row and sends only once", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([mockTransaction])
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendBatchReceipts([
      { transactionId: 10, toEmail: "a@b.com" },
      { transactionId: 10, toEmail: "A@B.com" }, // case-insensitive duplicate of the row above
    ])
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      sent: 1,
      failed: 1,
      errors: [{ transactionId: 10, error: "Duplicate recipient — already processed in this batch" }],
    })
  })

  it("counts the row as sent, not failed, when the SUCCESS audit row fails to persist after delivery", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([mockTransaction])
    mockSendEmail.mockResolvedValue(undefined)
    mockReceiptCreate.mockRejectedValue(new Error("DB write error"))
    const result = await sendBatchReceipts([{ transactionId: 10, toEmail: "a@b.com" }])
    expect(mockReceiptCreate).toHaveBeenCalledTimes(1)
    expect(mockReceiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "SUCCESS" }),
    })
    // The recipient already received the email — this must count as sent, not failed.
    expect(result).toEqual({ sent: 1, failed: 0, errors: [] })
  })
})

// --- fetchTransactionsForReceipt ---
describe("email validation", () => {
  it.each([
    ".test@example.com", // leading dot in local part
    "a..b@example.com", // consecutive dots in local part
    "test@example..com", // consecutive dots in domain
    "test@example.com.", // trailing dot
    "test@.example.com", // leading dot in domain
    "notanemail",
  ])("rejects malformed address %p", async (bad) => {
    mockSession.mockResolvedValue(adminSession)
    const result = await sendSingleReceipt(10, bad)
    expect(result).toEqual({ error: "Invalid email address" })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("accepts a well-formed address", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindUnique.mockResolvedValue(mockTransaction)
    mockSendEmail.mockResolvedValue(undefined)
    const result = await sendSingleReceipt(10, "jane.doe@example.co.uk")
    expect(result).toEqual({ success: "Receipt sent to jane.doe@example.co.uk" })
  })
})

describe("fetchTransactionsForReceipt", () => {
  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue(viewerSession)
    const result = await fetchTransactionsForReceipt("2026-01-01", "2026-12-31")
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns transaction rows for ADMIN", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([{
      id: 10,
      date: new Date("2026-05-15"),
      description: "Sunday Offering",
      amount: { toString: () => "500.00" },
      account: { code: "4001", name: "Sunday Offering" },
      family: { name: "Smith", people: [{ email: "enc:smith@example.com" }] },
      person: null,
      receiptSends: [],
    }])
    const result = await fetchTransactionsForReceipt("2026-01-01", "2026-12-31")
    expect("error" in result!).toBe(false)
    if ("transactions" in result!) {
      expect(result.transactions).toHaveLength(1)
      expect(result.transactions[0].defaultEmail).toBe("smith@example.com")
    }
  })

  it("rejects a regex-valid but calendar-invalid date without a 500", async () => {
    mockSession.mockResolvedValue(adminSession)
    const result = await fetchTransactionsForReceipt("2026-13-45", "2026-02-30")
    expect(result).toEqual({ error: "Invalid date range" })
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it("decrypts description in transaction list", async () => {
    mockSession.mockResolvedValue(adminSession)
    mockFindMany.mockResolvedValue([{
      id: 10,
      date: new Date("2026-05-15"),
      description: "enc:Sunday Offering",
      amount: { toString: () => "500.00" },
      account: { code: "4001", name: "Sunday Offering" },
      family: { name: "Smith", people: [] },
      person: null,
      receiptSends: [],
    }])
    const result = await fetchTransactionsForReceipt("2026-01-01", "2026-12-31")
    expect(result).not.toHaveProperty("error")
    const r = result as { transactions: { description: string }[] }
    expect(r.transactions[0].description).toBe("Sunday Offering")
  })
})

// --- decrypt on email send ---
describe("sendSingleReceipt — description decryption", () => {
  it("decrypts encrypted description before sending email", async () => {
    mockSession.mockResolvedValue(adminSession)
    const txEncrypted = { ...mockTransaction, description: "enc:Sunday Offering" }
    mockFindUnique.mockResolvedValue(txEncrypted)
    mockSendEmail.mockResolvedValue(undefined)
    await sendSingleReceipt(10, "test@example.com")
    const emailData = mockSendEmail.mock.calls[0][1]
    expect(emailData.description).toBe("Sunday Offering")
  })
})

describe("sendSingleReceipt email bound", () => {
  it("rejects an over-long email before any send/DB write", async () => {
    mockSession.mockResolvedValue(adminSession)
    const result = await sendSingleReceipt(10, "a".repeat(250) + "@example.com")
    expect(result).toEqual({ error: "Invalid email address" })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
