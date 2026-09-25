/** @jest-environment node */

import { POST } from "@/app/api/import/bank-statement/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { parseAnzStatement } from "@/lib/anzParser"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: jest.fn() } },
}))
jest.mock("unpdf", () => ({
  extractText: jest.fn().mockResolvedValue({ text: ["MOCK PDF TEXT"] }),
}))
jest.mock("@/lib/anzParser", () => ({
  // Keep the real pure helpers (contentKeyFromBankRef, bankRefContentKey); only
  // the parser entry points are stubbed so the route can be exercised offline.
  ...jest.requireActual("@/lib/anzParser"),
  parseAnzStatement: jest.fn(),
}))

const mockRow = {
  date: "2025-06-23",
  description: "PAYMENT FROM JACK",
  details: "PAYMENT FROM JACK | JACK",
  amount: "60.00",
  type: "INCOME",
  bankRef: "ANZ_987654321_20250623_60.00_PAYMENTFROMJACK",
  dedupKey: "987654321_20250623_60.00_PAYMENTFROMJACK",
}

describe("POST /api/import/bank-statement", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    ;(parseAnzStatement as jest.Mock).mockReturnValue({
      rows: [mockRow],
      period: { from: "2025-06-20", to: "2025-07-22" },
      accountNumber: "987654321",
      errors: [],
    })
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
  })

  test("returns 401 for unauthenticated user", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    const formData = new FormData()
    formData.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "test.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    expect(res.status).toBe(401)
  })

  test("returns 403 for VIEWER role", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const formData = new FormData()
    formData.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "test.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    expect(res.status).toBe(403)
  })

  test("returns 400 when no file provided", async () => {
    const formData = new FormData()
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    expect(res.status).toBe(400)
  })

  test("returns parsed rows and marks existing bankRefs as duplicates", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ bankRef: mockRow.bankRef }])
    const formData = new FormData()
    formData.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "test.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.rows).toHaveLength(1)
    expect(body.duplicateBankRefs).toContain(mockRow.bankRef)
    expect(body.period.from).toBe("2025-06-20")
  })

  test("returns empty duplicateBankRefs when no existing transactions", async () => {
    const formData = new FormData()
    formData.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "test.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    const body = await res.json()
    expect(body.duplicateBankRefs).toHaveLength(0)
  })

  test("marks a report-format row as duplicate when the same transaction exists as a statement row", async () => {
    // Incoming row is a Transaction Report row (ANZTR_ ref); the DB already holds
    // the same transaction imported as a Statement row (ANZ_ ref). Different exact
    // bankRefs, same content key → must be flagged duplicate via the date-window
    // content-key scan.
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1001", role: "ADMIN" } })
    ;(parseAnzStatement as jest.Mock).mockReturnValue({
      rows: [
        {
          date: "2026-06-08",
          description: "PAYMENT FROM BRUNO",
          details: "PAYMENT FROM BRUNO",
          amount: "300.00",
          type: "INCOME",
          bankRef: "ANZTR_987654321_20260608_300.00_PAYMENTFROMBRUNO_0",
          dedupKey: "987654321_20260608_300.00_PAYMENTFROMBRUNO",
        },
      ],
      period: { from: "2026-06-01", to: "2026-06-30" },
      accountNumber: "987654321",
      errors: [],
    })
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([
      { bankRef: "ANZ_987654321_20260608_300.00_PAYMENTFROMBRUNO_1030000" },
    ])
    const formData = new FormData()
    formData.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "test.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.duplicateBankRefs).toContain("ANZTR_987654321_20260608_300.00_PAYMENTFROMBRUNO_0")
  })

  test("rejects a statement that parses to more than the row cap with 413", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1002", role: "ADMIN" } })
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      date: "2025-06-23",
      description: `ROW ${i}`,
      details: `ROW ${i}`,
      amount: "1.00",
      type: "INCOME",
      bankRef: `ANZ_987654321_20250623_1.00_ROW${i}_${i}`,
      dedupKey: `987654321_20250623_1.00_ROW${i}`,
    }))
    ;(parseAnzStatement as jest.Mock).mockReturnValue({
      rows,
      period: { from: "2025-06-20", to: "2025-07-22" },
      accountNumber: "987654321",
      errors: [],
    })
    const formData = new FormData()
    formData.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "test.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    expect(res.status).toBe(413)
    // The dedup scan must not run when the cap is exceeded.
    expect(prisma.transaction.findMany as jest.Mock).not.toHaveBeenCalled()
  })

  test("never returns raw statement lines in errors — count summary only", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {})
    ;(parseAnzStatement as jest.Mock).mockReturnValue({
      rows: [mockRow],
      period: { from: "2025-06-20", to: "2025-07-22" },
      accountNumber: "987654321",
      errors: ["Could not parse amounts for: PAYMENT TO SECRET PAYEE 123.45"],
    })
    const formData = new FormData()
    formData.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "test.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain("SECRET PAYEE")
    expect(body.errors).toEqual(["1 statement block could not be parsed and was skipped"])
  })

  test("returns a generic 400 when nothing parses — no raw line detail", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {})
    ;(parseAnzStatement as jest.Mock).mockReturnValue({
      rows: [],
      period: null,
      accountNumber: null,
      errors: ["Could not parse amounts for: PAYMENT TO SECRET PAYEE 123.45"],
    })
    const formData = new FormData()
    formData.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "test.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(JSON.stringify(body)).not.toContain("SECRET PAYEE")
  })

  test("returns 413 on oversized Content-Length without buffering the body", async () => {
    // The guard must return before req.formData() — otherwise the whole multipart
    // body streams into memory before the size check fires.
    const formData = jest.fn(() => {
      throw new Error("body must not be buffered when Content-Length is over the cap")
    })
    const req = {
      headers: { get: (k: string) => (k === "content-length" ? String(56 * 1024 * 1024) : null) },
      formData,
    } as unknown as Request
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(formData).not.toHaveBeenCalled()
  })

  test("rejects a non-PDF upload with 400", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const formData = new FormData()
    formData.append("file", new Blob(["not a pdf"], { type: "text/plain" }), "evil.txt")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("File must be a PDF")
  })

  test("rejects a file with a spoofed application/pdf MIME but no %PDF header", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const formData = new FormData()
    formData.append("file", new Blob(["<html>gotcha</html>"], { type: "application/pdf" }), "evil.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("File must be a PDF")
  })

  test("accepts a PDF whose %PDF header is preceded by leading bytes", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const formData = new FormData()
    // Some PDFs carry whitespace/BOM before %PDF — must still be accepted.
    formData.append("file", new Blob(["﻿  %PDF-1.7"], { type: "application/octet-stream" }), "stmt.pdf")
    const res = await POST(new Request("http://localhost", { method: "POST", body: formData, headers: { "content-length": "1024" } }))
    expect(res.status).toBe(200)
  })
})
