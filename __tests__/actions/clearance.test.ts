/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    $queryRaw: jest.fn(),
    person: { findUnique: jest.fn() },
    personClearance: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  }
  // The interactive transaction runs on the same mocks.
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma))
  return { prisma }
})
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { logAudit } from "@/lib/audit"
import {
  upsertClearance,
  verifyClearance,
  unverifyClearance,
  deleteClearance,
} from "@/lib/actions/clearance"

const mockAuth = auth as jest.Mock
const personFind = prisma.person.findUnique as jest.Mock
const find = prisma.personClearance.findUnique as jest.Mock
const create = prisma.personClearance.create as jest.Mock
const update = prisma.personClearance.update as jest.Mock
const updateMany = prisma.personClearance.updateMany as jest.Mock
const deleteMany = prisma.personClearance.deleteMany as jest.Mock
const queryRaw = prisma.$queryRaw as jest.Mock

const ADMIN = { user: { role: "ADMIN", id: "5" } }
const OFFICE = { user: { role: "OFFICE_ADMIN", id: "6" } }
const VIEWER = { user: { role: "VIEWER", id: "9" } }
const AUDITOR = { user: { role: "AUDITOR", id: "10" } }

const pngBytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const pngFile = (name = "wwcc.png") => new File([pngBytes()], name, { type: "image/png" })
const fd = (fields: Record<string, string>, file?: File) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  if (file) f.set("document", file)
  return f
}

const CID = "ckclearance000000000000001"
const UPDATED = new Date("2026-10-01T00:00:00.000Z")
const SEEN = UPDATED.toISOString()

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue(ADMIN)
  personFind.mockResolvedValue({ id: 3, archivedAt: null })
  find.mockResolvedValue(null)
  create.mockResolvedValue({ id: CID })
  update.mockResolvedValue({ id: CID })
  updateMany.mockResolvedValue({ count: 1 })
  deleteMany.mockResolvedValue({ count: 1 })
  queryRaw.mockResolvedValue([{ id: 3 }])
})

describe("guards (every action)", () => {
  it.each([["VIEWER", VIEWER], ["AUDITOR", AUDITOR], ["anonymous", null]])("%s is Unauthorized", async (_n, s) => {
    mockAuth.mockResolvedValue(s)
    expect(await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))).toEqual({ error: "Unauthorized" })
    expect(await verifyClearance(CID, SEEN)).toEqual({ error: "Unauthorized" })
    expect(await unverifyClearance(CID, SEEN)).toEqual({ error: "Unauthorized" })
    expect(await deleteClearance(CID, SEEN)).toEqual({ error: "Unauthorized" })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it("OFFICE_ADMIN (canEdit) is allowed", async () => {
    mockAuth.mockResolvedValue(OFFICE)
    expect(await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))).toBeUndefined()
  })

  it("is disabled in demo mode, before anything else", async () => {
    process.env.DEMO_MODE = "true"
    try {
      const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))
      expect(r && "error" in r).toBe(true)
      expect(mockAuth).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    } finally {
      delete process.env.DEMO_MODE
    }
  })
})

describe("upsertClearance validation", () => {
  it("rejects an impossible expiry date", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-02-30" }))
    expect(r).toEqual({ error: "Enter a valid expiry date." })
    expect(create).not.toHaveBeenCalled()
  })
  it("rejects an empty first submission", async () => {
    const r = await upsertClearance(3, "WWCC", fd({}))
    expect(r && "error" in r).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
  it("rejects an over-long number", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: "X".repeat(41), expiresAt: "2027-01-01" }))
    expect(r && "error" in r).toBe(true)
  })
  it("rejects an unknown type", async () => {
    const r = await upsertClearance(3, "NOPE" as never, fd({ expiresAt: "2027-01-01" }))
    expect(r).toEqual({ error: "Not found" })
  })
  it("rejects a declared type outside JPEG/PNG/PDF", async () => {
    const txt = new File([new Uint8Array([1, 2])], "a.txt", { type: "text/plain" })
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }, txt))
    expect(r && "error" in r).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
  it("rejects an oversized file without reading it into memory", async () => {
    const big = pngFile()
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 })
    const spy = jest.spyOn(big, "arrayBuffer")
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }, big))
    expect(r).toEqual({ error: "Document must be 4 MB or smaller." })
    expect(spy).not.toHaveBeenCalled()
  })
  it("rejects bad magic bytes (declared PDF, not a PDF)", async () => {
    const fake = new File([new Uint8Array([0, 1, 2, 3, 4])], "fake.pdf", { type: "application/pdf" })
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }, fake))
    expect(r && "error" in r).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
  it("rejects when the sniffed type differs from the declared type", async () => {
    const mismatch = new File([pngBytes()], "x.pdf", { type: "application/pdf" })
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }, mismatch))
    expect(r && "error" in r).toBe(true)
  })
  it("404s an archived or missing person", async () => {
    personFind.mockResolvedValue({ id: 3, archivedAt: new Date() })
    expect(await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))).toEqual({ error: "Not found" })
    personFind.mockResolvedValue(null)
    expect(await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))).toEqual({ error: "Not found" })
  })
})

describe("upsertClearance create", () => {
  it("encrypts number/filename/blob, stores UTC-midnight expiry, audits, revalidates", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: " wwc0000000e ", expiresAt: "2029-03-15" }, pngFile("my wwcc.png")))
    expect(r).toBeUndefined()
    const data = create.mock.calls[0][0].data
    expect(data.personId).toBe(3)
    expect(data.type).toBe("WWCC")
    expect(data.number).toBe("enc:WWC0000000E")
    expect(data.expiresAt).toEqual(new Date("2029-03-15T00:00:00.000Z"))
    expect(data.documentName).toBe("enc:my wwcc.png")
    expect(data.documentType).toBe("image/png")
    expect(data.documentSize).toBe(pngBytes().length)
    expect(Buffer.isBuffer(data.document)).toBe(true)
    expect(data.document.toString("utf8")).toBe(`enc:${Buffer.from(pngBytes()).toString("base64")}`)
    expect(data.createdById).toBe(5)
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_ADDED", "Person", 3, expect.objectContaining({ type: "WWCC" }))
    // Audit metadata must never carry the number.
    expect(JSON.stringify((logAudit as jest.Mock).mock.calls[0])).not.toContain("WWC0000000E")
    expect(revalidatePath).toHaveBeenCalledWith("/people/3")
  })

  it("Safe Ministry numbers are not upper-cased", async () => {
    await upsertClearance(3, "SAFE_MINISTRY", fd({ number: "cert-1", expiresAt: "2029-03-15" }))
    expect(create.mock.calls[0][0].data.number).toBe("enc:cert-1")
  })

  it("returns a friendly error when a concurrent create hits the unique key", async () => {
    create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }))
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2029-03-15" }))
    expect(r && "error" in r).toBe(true)
  })
})

describe("upsertClearance update", () => {
  const existing = {
    id: CID,
    number: "enc:WWC0000000E",
    expiresAt: new Date("2029-03-15T00:00:00.000Z"),
    verifiedAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: UPDATED,
  }
  beforeEach(() => find.mockResolvedValue(existing))

  it("rejects an edit whose seen updatedAt no longer matches", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", expiresAt: "2034-03-15", updatedAt: "2026-09-01T00:00:00.000Z" }))
    expect(r).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("accepts an edit whose seen updatedAt matches", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", expiresAt: "2034-03-15", updatedAt: SEEN }))
    expect(r).toBeUndefined()
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it("changing the expiry clears verification and audits UPDATED", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", updatedAt: SEEN, expiresAt: "2034-03-15" }))
    expect(r).toBeUndefined()
    const { where, data } = updateMany.mock.calls[0][0]
    expect(where).toEqual({ id: CID, updatedAt: UPDATED, person: { archivedAt: null } })
    expect(data.expiresAt).toEqual(new Date("2034-03-15T00:00:00.000Z"))
    expect(data).toMatchObject({ verifiedAt: null, verifiedById: null, verificationNote: null })
    expect(data.document).toBeUndefined() // no new file -> existing document kept
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_UPDATED", "Person", 3,
      expect.objectContaining({ type: "WWCC", verificationCleared: true, documentReplaced: false }))
    expect(create).not.toHaveBeenCalled()
  })

  it("changing the number clears verification", async () => {
    await upsertClearance(3, "WWCC", fd({ number: "WWC9999999E", updatedAt: SEEN, expiresAt: "2029-03-15" }))
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ number: "enc:WWC9999999E", verifiedAt: null })
  })

  it("uploading a new document alone counts as a change", async () => {
    await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", updatedAt: SEEN, expiresAt: "2029-03-15" }, pngFile()))
    const { data } = updateMany.mock.calls[0][0]
    expect(data.documentType).toBe("image/png")
    expect(data.verifiedAt).toBeNull()
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_UPDATED", "Person", 3, expect.objectContaining({ documentReplaced: true }))
  })

  it("rejects an edit that empties the last field of a document-less clearance", async () => {
    find.mockResolvedValue({ ...existing, number: null, documentType: null })
    const r = await upsertClearance(3, "WWCC", fd({ updatedAt: SEEN, expiresAt: "" }))
    expect(r).toEqual({ error: "Enter an expiry date, number or document." })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("allows clearing number + expiry when a document is kept", async () => {
    find.mockResolvedValue({ ...existing, documentType: "image/png" })
    const r = await upsertClearance(3, "WWCC", fd({ updatedAt: SEEN, expiresAt: "" }))
    expect(r).toBeUndefined()
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it("an unchanged resubmit is a no-op (verification kept, no audit)", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", updatedAt: SEEN, expiresAt: "2029-03-15" }))
    expect(r).toBeUndefined()
    expect(updateMany).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("rejects a stale Add form (no seen updatedAt) when the row now exists", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", expiresAt: "2034-03-15" }))
    expect(r).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("rejects when the row changed between read and write (guarded updateMany count 0)", async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const r = await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", updatedAt: SEEN, expiresAt: "2034-03-15" }))
    expect(r).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("404s a create when the person was archived after the pre-read (locked re-check)", async () => {
    find.mockResolvedValue(null)
    queryRaw.mockResolvedValue([])
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2034-03-15" }))
    expect(r).toEqual({ error: "Not found" })
    expect(create).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("rejects resubmitting the placeholder of an undecryptable number (keeps ciphertext)", async () => {
    find.mockResolvedValue({ id: CID, number: "bad-ciphertext", expiresAt: null, verifiedAt: null, updatedAt: UPDATED, documentType: null })
    const crypto = jest.requireMock("@/lib/crypto")
    crypto.safeDecrypt.mockReturnValueOnce("[decryption error]")
    const r = await upsertClearance(3, "WWCC", fd({ number: "[decryption error]", updatedAt: SEEN, expiresAt: "2034-03-15" }))
    expect(r).toEqual({ error: expect.stringContaining("can't be read") })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("lets an explicitly entered number replace an undecryptable one", async () => {
    find.mockResolvedValue({ id: CID, number: "bad-ciphertext", expiresAt: null, verifiedAt: null, updatedAt: UPDATED, documentType: null })
    const crypto = jest.requireMock("@/lib/crypto")
    crypto.safeDecrypt.mockReturnValueOnce("[decryption error]")
    expect(await upsertClearance(3, "WWCC", fd({ number: "WWC1234567E", updatedAt: SEEN }))).toBeUndefined()
    expect(updateMany.mock.calls[0][0].data.number).toBe("enc:WWC1234567E")
  })
  it("rejects a stale edit after a concurrent removal instead of recreating", async () => {
    find.mockResolvedValue(null)
    const r = await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", updatedAt: SEEN, expiresAt: "2034-03-15" }))
    expect(r).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(create).not.toHaveBeenCalled()
  })
})

describe("verifyClearance", () => {
  const row = { id: CID, personId: 3, type: "WWCC", updatedAt: UPDATED, person: { archivedAt: null } }
  beforeEach(() => find.mockResolvedValue(row))

  it("marks verified by the actor, encrypts the note, audits, revalidates", async () => {
    const r = await verifyClearance(CID, SEEN, "  checked on OCG portal  ")
    expect(r).toBeUndefined()
    const { where, data } = updateMany.mock.calls[0][0]
    expect(where).toEqual({ id: CID, updatedAt: UPDATED, person: { archivedAt: null } })
    expect(data.verifiedById).toBe(5)
    expect(data.verifiedAt).toBeInstanceOf(Date)
    expect(data.verificationNote).toBe("enc:checked on OCG portal")
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_VERIFIED", "Person", 3,
      expect.objectContaining({ type: "WWCC", clearanceId: CID, hasNote: true }))
    expect(revalidatePath).toHaveBeenCalledWith("/people/3")
  })
  it("stores a null note when blank", async () => {
    await verifyClearance(CID, SEEN)
    expect(updateMany.mock.calls[0][0].data.verificationNote).toBeNull()
  })
  it("rejects a note over 500 chars", async () => {
    const r = await verifyClearance(CID, SEEN, "x".repeat(501))
    expect(r && "error" in r).toBe(true)
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("404s an unknown or malformed id", async () => {
    find.mockResolvedValue(null)
    expect(await verifyClearance(CID, SEEN)).toEqual({ error: "Not found" })
    expect(await verifyClearance("../bad id", SEEN)).toEqual({ error: "Not found" })
  })
  it("errors when the row changed since the page loaded (stale seen value)", async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const r = await verifyClearance(CID, "2026-09-01T00:00:00.000Z")
    expect(r).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: CID, updatedAt: new Date("2026-09-01T00:00:00.000Z"), person: { archivedAt: null } })
    expect(logAudit).not.toHaveBeenCalled()
  })
  it.each([["empty", ""], ["malformed", "not-a-date"], ["missing", undefined]])(
    "rejects a %s seen value without writing",
    async (_n, seen) => {
      const r = await verifyClearance(CID, seen as never)
      expect(r).toEqual({ error: "This clearance changed. Refresh and try again." })
      expect(updateMany).not.toHaveBeenCalled()
    },
  )
})

describe("unverifyClearance / deleteClearance", () => {
  beforeEach(() => find.mockResolvedValue({ id: CID, personId: 3, type: "SAFE_MINISTRY", updatedAt: UPDATED, person: { archivedAt: null } }))

  it("unverify clears the verification fields (guarded on seen updatedAt) and audits", async () => {
    expect(await unverifyClearance(CID, SEEN)).toBeUndefined()
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: CID, updatedAt: UPDATED, person: { archivedAt: null } },
      data: { verifiedAt: null, verifiedById: null, verificationNote: null },
    })
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_UNVERIFIED", "Person", 3, expect.objectContaining({ type: "SAFE_MINISTRY" }))
  })
  it("unverify errors on a stale or malformed seen value", async () => {
    updateMany.mockResolvedValue({ count: 0 })
    expect(await unverifyClearance(CID, SEEN)).toEqual({ error: "This clearance changed. Refresh and try again." })
    updateMany.mockClear()
    expect(await unverifyClearance(CID, "junk")).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(updateMany).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("delete is guarded on the seen updatedAt, then audits REMOVED", async () => {
    expect(await deleteClearance(CID, SEEN)).toBeUndefined()
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: CID, updatedAt: UPDATED, person: { archivedAt: null } } })
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_REMOVED", "Person", 3, expect.objectContaining({ type: "SAFE_MINISTRY" }))
    expect(revalidatePath).toHaveBeenCalledWith("/people/3")
  })
  it("all three 404 a clearance whose person is archived", async () => {
    find.mockResolvedValue({ id: CID, personId: 3, type: "SAFE_MINISTRY", updatedAt: UPDATED, person: { archivedAt: new Date() } })
    expect(await verifyClearance(CID, SEEN)).toEqual({ error: "Not found" })
    expect(await unverifyClearance(CID, SEEN)).toEqual({ error: "Not found" })
    expect(await deleteClearance(CID, SEEN)).toEqual({ error: "Not found" })
    expect(updateMany).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })
  it("delete errors and does not audit when the row changed since seen", async () => {
    deleteMany.mockResolvedValue({ count: 0 })
    expect(await deleteClearance(CID, SEEN)).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("delete rejects a malformed seen value without writing", async () => {
    expect(await deleteClearance(CID, "junk")).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(deleteMany).not.toHaveBeenCalled()
  })
  it("both 404 a missing row", async () => {
    find.mockResolvedValue(null)
    expect(await unverifyClearance(CID, SEEN)).toEqual({ error: "Not found" })
    expect(await deleteClearance(CID, SEEN)).toEqual({ error: "Not found" })
  })
})
