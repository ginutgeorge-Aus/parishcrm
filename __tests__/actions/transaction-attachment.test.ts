/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findUnique: jest.fn() },
    transactionAttachment: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn(), count: jest.fn() },
    appSetting: { findUnique: jest.fn() },
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { logAudit } from "@/lib/audit"
import { attachTransactionReceipt, removeTransactionReceipt } from "@/lib/actions/transactionAttachment"

const mockAuth = auth as jest.Mock
const txFind = prisma.transaction.findUnique as jest.Mock
const attCreate = prisma.transactionAttachment.create as jest.Mock
const attFind = prisma.transactionAttachment.findUnique as jest.Mock
const attDelete = prisma.transactionAttachment.delete as jest.Mock
const attCount = prisma.transactionAttachment.count as jest.Mock
const appSettingFind = prisma.appSetting.findUnique as jest.Mock

const ADMIN = { user: { role: "ADMIN", id: "5" } }
const AUDITOR = { user: { role: "AUDITOR", id: "9" } }

const pngBytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const fd = (file: File | null) => {
  const f = new FormData()
  if (file) f.set("file", file)
  return f
}
const pngFile = (name = "receipt.png") => new File([pngBytes()], name, { type: "image/png" })

beforeEach(() => {
  jest.clearAllMocks()
  txFind.mockResolvedValue({ id: 1, date: new Date("2026-05-15") })
  attCreate.mockResolvedValue({ id: 100 })
  attCount.mockResolvedValue(0)
  appSettingFind.mockResolvedValue(null) // no accounting lock date set → unlocked
})

describe("attachTransactionReceipt", () => {
  it("rejects a read-only accounting role (AUDITOR)", async () => {
    mockAuth.mockResolvedValue(AUDITOR)
    const r = await attachTransactionReceipt(1, undefined, fd(pngFile()))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("errors when no file is supplied", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const r = await attachTransactionReceipt(1, undefined, fd(null))
    expect(r && "error" in r).toBe(true)
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("rejects a disallowed content type", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const bad = new File([new Uint8Array([1, 2, 3])], "note.txt", { type: "text/plain" })
    const r = await attachTransactionReceipt(1, undefined, fd(bad))
    expect(r && "error" in r).toBe(true)
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("rejects an oversized file without reading it into memory", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const big = pngFile()
    // Fake a size over the cap so arrayBuffer() must not be reached.
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 })
    const spy = jest.spyOn(big, "arrayBuffer")
    const r = await attachTransactionReceipt(1, undefined, fd(big))
    expect(r && "error" in r).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("rejects a PDF whose magic header is not %PDF", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const fake = new File([new Uint8Array([0, 1, 2, 3, 4])], "fake.pdf", { type: "application/pdf" })
    const r = await attachTransactionReceipt(1, undefined, fd(fake))
    expect(r && "error" in r).toBe(true)
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("errors when the parent transaction does not exist", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    txFind.mockResolvedValue(null)
    const r = await attachTransactionReceipt(999, undefined, fd(pngFile()))
    expect(r).toEqual({ error: "Not found" })
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("stores a valid image encrypted at rest and logs the audit event", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const r = await attachTransactionReceipt(1, undefined, fd(pngFile("my scan.png")))
    expect(r).toBeUndefined()
    expect(attCreate).toHaveBeenCalledTimes(1)
    const data = attCreate.mock.calls[0][0].data
    expect(data.transactionId).toBe(1)
    expect(data.contentType).toBe("image/png")
    // Filename is encrypted at rest, not stored plaintext.
    expect(data.filename).toBe("enc:my scan.png")
    expect(data.uploadedById).toBe(5)
    // size is the ORIGINAL byte length, not the encrypted blob length.
    expect(data.size).toBe(pngBytes().length)
    // Blob is base64-encoded then encrypted; round-trips back to raw bytes.
    expect(Buffer.isBuffer(data.data)).toBe(true)
    const decoded = Buffer.from(data.data.toString("utf8").replace(/^enc:/, ""), "base64")
    expect(Uint8Array.from(decoded)).toEqual(pngBytes())
    expect(logAudit).toHaveBeenCalledWith(5, "TRANSACTION_ATTACHMENT_ADDED", "Transaction", 1, expect.any(Object))
    expect(revalidatePath).toHaveBeenCalledWith("/accounting/transactions/1")
  })

  it("refuses to attach to a transaction in a locked period", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    txFind.mockResolvedValue({ id: 1, date: new Date("2025-06-30") })
    appSettingFind.mockResolvedValue({ value: "2025-12-31" }) // lock date after the tx date
    const r = await attachTransactionReceipt(1, undefined, fd(pngFile()))
    expect(r && "error" in r && /locked/.test(r.error)).toBe(true)
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("rejects a transaction id above the int4 ceiling before touching the DB", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const r = await attachTransactionReceipt(2147483648, undefined, fd(pngFile()))
    expect(r).toEqual({ error: "Not found" })
    expect(txFind).not.toHaveBeenCalled()
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("rejects when the per-transaction attachment cap is reached", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    attCount.mockResolvedValue(20)
    const r = await attachTransactionReceipt(1, undefined, fd(pngFile()))
    expect(r && "error" in r).toBe(true)
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("accepts a real PDF", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "r.pdf", { type: "application/pdf" })
    const r = await attachTransactionReceipt(1, undefined, fd(pdf))
    expect(r).toBeUndefined()
    expect(attCreate).toHaveBeenCalledTimes(1)
    expect(attCreate.mock.calls[0][0].data.contentType).toBe("application/pdf")
  })

  it("accepts a real JPEG and stores the sniffed content type", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "scan.jpg", { type: "image/jpeg" })
    const r = await attachTransactionReceipt(1, undefined, fd(jpeg))
    expect(r).toBeUndefined()
    expect(attCreate.mock.calls[0][0].data.contentType).toBe("image/jpeg")
  })

  it("rejects an image whose magic bytes don't match the declared type", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    // PNG bytes declared as image/jpeg — passes the MIME allowlist but the sniff
    // catches the mismatch.
    const spoof = new File([pngBytes()], "spoof.jpg", { type: "image/jpeg" })
    const r = await attachTransactionReceipt(1, undefined, fd(spoof))
    expect(r && "error" in r).toBe(true)
    expect(attCreate).not.toHaveBeenCalled()
  })

  it("rejects a non-image payload labelled image/png", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const payload = new File([new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74])], "x.png", { type: "image/png" })
    const r = await attachTransactionReceipt(1, undefined, fd(payload))
    expect(r && "error" in r).toBe(true)
    expect(attCreate).not.toHaveBeenCalled()
  })
})

describe("removeTransactionReceipt", () => {
  it("rejects a read-only accounting role", async () => {
    mockAuth.mockResolvedValue(AUDITOR)
    const r = await removeTransactionReceipt(100)
    expect(r).toEqual({ error: "Unauthorized" })
    expect(attDelete).not.toHaveBeenCalled()
  })

  it("errors when the attachment does not exist", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    attFind.mockResolvedValue(null)
    const r = await removeTransactionReceipt(100)
    expect(r).toEqual({ error: "Not found" })
    expect(attDelete).not.toHaveBeenCalled()
  })

  it("deletes an existing attachment and logs the audit event", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    attFind.mockResolvedValue({ id: 100, transactionId: 1, transaction: { date: new Date("2026-05-15") } })
    const r = await removeTransactionReceipt(100)
    expect(r).toBeUndefined()
    expect(attDelete).toHaveBeenCalledWith({ where: { id: 100 } })
    expect(logAudit).toHaveBeenCalledWith(5, "TRANSACTION_ATTACHMENT_REMOVED", "Transaction", 1, expect.any(Object))
    expect(revalidatePath).toHaveBeenCalledWith("/accounting/transactions/1")
  })

  it("refuses to remove an attachment from a locked-period transaction", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    attFind.mockResolvedValue({ id: 100, transactionId: 1, transaction: { date: new Date("2025-06-30") } })
    appSettingFind.mockResolvedValue({ value: "2025-12-31" })
    const r = await removeTransactionReceipt(100)
    expect(r && "error" in r && /locked/.test(r.error)).toBe(true)
    expect(attDelete).not.toHaveBeenCalled()
  })
})
