/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: { transactionAttachment: { findUnique: jest.fn() } },
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => true),
}))

import { NextRequest } from "next/server"
import { GET } from "@/app/api/accounting/transactions/[id]/attachments/[attachmentId]/route"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"

const findUnique = prisma.transactionAttachment.findUnique as jest.Mock
const mockAuth = auth as jest.Mock
const mockLogAudit = logAudit as jest.Mock
const mockRateLimit = rateLimit as jest.Mock
const call = (id: string, attachmentId: string) =>
  GET(new NextRequest("http://test.local/"), { params: Promise.resolve({ id, attachmentId }) })

// Blobs rest as base64 ciphertext (UTF-8 bytes); filenames rest encrypted.
const storedBlob = (raw: string) => Buffer.from(`enc:${Buffer.from(raw).toString("base64")}`, "utf8")
const encName = (n: string) => `enc:${n}`

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

it("404s a non-accounting role without touching the DB", async () => {
  mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "2" } })
  const res = await call("1", "5")
  expect(res.status).toBe(404)
  expect(findUnique).not.toHaveBeenCalled()
})

it("404s an unauthenticated request", async () => {
  mockAuth.mockResolvedValue(null)
  const res = await call("1", "5")
  expect(res.status).toBe(404)
})

it("404s a non-numeric id without touching the DB", async () => {
  const res = await call("abc", "5")
  expect(res.status).toBe(404)
  expect(findUnique).not.toHaveBeenCalled()
})

it("decrypts and serves an attachment with its content type and a filename", async () => {
  findUnique.mockResolvedValue({
    data: storedBlob("PDFBYTES"),
    contentType: "application/pdf",
    filename: encName("receipt.pdf"),
    transactionId: 1,
  })
  const res = await call("1", "5")
  expect(res.status).toBe(200)
  expect(res.headers.get("Content-Type")).toBe("application/pdf")
  expect(res.headers.get("Content-Disposition")).toContain("receipt.pdf")
  expect(res.headers.get("Cache-Control")).toContain("private")
  expect(await res.text()).toBe("PDFBYTES")
  // Egress of a decrypted financial document leaves a forensic trail.
  expect(mockLogAudit).toHaveBeenCalledWith(
    1,
    "TRANSACTION_ATTACHMENT_VIEWED",
    "Transaction",
    1,
    { attachmentId: 5 },
    "unknown",
  )
})

it("uses an ASCII-safe fallback filename plus a UTF-8 param for non-ASCII names", async () => {
  findUnique.mockResolvedValue({
    data: storedBlob("x"),
    contentType: "image/png",
    filename: encName("réçeipt スキャン.png"),
    transactionId: 1,
  })
  const res = await call("1", "5")
  const cd = res.headers.get("Content-Disposition") ?? ""
  // Legacy ASCII fallback: non-ASCII replaced with "_", no raw non-ASCII bytes.
  expect(cd).toMatch(/filename="[\x20-\x7e]+"/)
  expect(/filename="[^"]*[^\x00-\x7f]/.test(cd)).toBe(false)
  // RFC 5987 UTF-8 param carries the real name percent-encoded.
  expect(cd).toContain("filename*=UTF-8''")
})

it("rate-limits by actor before touching the DB", async () => {
  mockRateLimit.mockReturnValueOnce(false)
  const res = await call("1", "5")
  expect(res.status).toBe(429)
  expect(findUnique).not.toHaveBeenCalled()
})

it("checks the rate limit against the actor id", async () => {
  findUnique.mockResolvedValue({
    data: storedBlob("x"),
    contentType: "image/png",
    filename: encName("a.png"),
    transactionId: 1,
  })
  await call("1", "5")
  expect(mockRateLimit).toHaveBeenCalledWith("attachment:1", 30, 60_000)
})

it("404s when the attachment does not exist", async () => {
  findUnique.mockResolvedValue(null)
  const res = await call("1", "5")
  expect(res.status).toBe(404)
})

it("404s when the attachment belongs to a different transaction (scope guard)", async () => {
  findUnique.mockResolvedValue({
    data: Buffer.from("x"),
    contentType: "image/png",
    filename: "a.png",
    transactionId: 999,
  })
  const res = await call("1", "5")
  expect(res.status).toBe(404)
})

it("is auditor-accessible (read-only accounting role)", async () => {
  mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "3" } })
  findUnique.mockResolvedValue({
    data: Buffer.from("y"),
    contentType: "image/png",
    filename: "a.png",
    transactionId: 1,
  })
  const res = await call("1", "5")
  expect(res.status).toBe(200)
})
