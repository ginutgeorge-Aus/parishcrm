/** @jest-environment node */
import {
  createSacramentRecord,
  updateSacramentRecord,
  deleteSacramentRecord,
  getSacramentRecord,
  searchSacramentPeople,
} from "@/lib/actions/sacrament"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAuditTx } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { logger } from "@/lib/logger"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/dates", () => ({
  sydneyTodayYMD: jest.fn(() => "2026-11-14"),
  utcYmd: (d: Date) => d.toISOString().slice(0, 10),
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findUnique: jest.fn(), findMany: jest.fn() },
    sacramentCounter: { upsert: jest.fn() },
    sacramentRecord: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

const p = prisma as unknown as {
  person: { findUnique: jest.Mock; findMany: jest.Mock }
  sacramentCounter: { upsert: jest.Mock }
  sacramentRecord: { create: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock; deleteMany: jest.Mock }
  $transaction: jest.Mock
}

/** Build a FormData from string fields. */
function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

/** Mock the signed-in role. */
function as(role: string | null) {
  ;(auth as jest.Mock).mockResolvedValue(role ? { user: { id: "9", role } } : null)
}

const BAPTISM = { type: "BAPTISM", personId: "5", date: "2026-03-01", place: "St Mark", godparents: "Jane Roe", notes: "n" }
const EXISTING = { type: "BAPTISM", year: 2026, personId: 5, spouseId: null, registerNo: "BAP-2026-003" }
const NON_EDITORS = ["OFFICE_ADMIN", "VIEWER", "AUDITOR", "EVENT_ORGANISER", "HEADMASTER", "TEACHER"]

beforeEach(() => {
  jest.clearAllMocks()
  p.$transaction.mockImplementation((cb: (t: unknown) => unknown) => Promise.resolve(cb(prisma)))
  p.person.findUnique.mockResolvedValue({ archivedAt: null })
  p.sacramentCounter.upsert.mockResolvedValue({ lastSeq: 14 })
  p.sacramentRecord.create.mockResolvedValue({ id: 101 })
  p.sacramentRecord.findUnique.mockResolvedValue(EXISTING)
  p.sacramentRecord.updateMany.mockResolvedValue({ count: 1 })
  p.sacramentRecord.deleteMany.mockResolvedValue({ count: 1 })
})

describe("createSacramentRecord", () => {
  it.each(["ADMIN", "PASTOR"])("%s creates and gets the next register number", async (role) => {
    as(role)
    const r = await createSacramentRecord(undefined, form(BAPTISM))
    expect(r).toEqual({ id: 101, registerNo: "BAP-2026-014" })
    expect(p.sacramentCounter.upsert).toHaveBeenCalledWith({
      where: { type_year: { type: "BAPTISM", year: 2026 } },
      create: { type: "BAPTISM", year: 2026, lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
      select: { lastSeq: true },
    })
    const data = p.sacramentRecord.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      type: "BAPTISM",
      year: 2026,
      seq: 14,
      registerNo: "BAP-2026-014",
      personId: 5,
      date: new Date("2026-03-01T00:00:00.000Z"),
      godparents: "enc:Jane Roe",
      notes: "enc:n",
      spouseName: null,
      createdById: 9,
    })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 9, "SACRAMENT_RECORD_CREATED", "SacramentRecord", 101, {
      registerNo: "BAP-2026-014",
      type: "BAPTISM",
      personId: 5,
      spouseId: null,
    })
    expect(revalidatePath).toHaveBeenCalledWith("/sacraments")
  })

  it.each([...NON_EDITORS, null])("rejects %s before any DB access", async (role) => {
    as(role)
    expect(await createSacramentRecord(undefined, form(BAPTISM))).toEqual({ error: "Unauthorized" })
    expect(p.$transaction).not.toHaveBeenCalled()
  })

  it("numbers by the rite date's year, not today's", async () => {
    as("ADMIN")
    p.sacramentCounter.upsert.mockResolvedValue({ lastSeq: 1 })
    const r = await createSacramentRecord(undefined, form({ ...BAPTISM, date: "1998-06-07" }))
    expect(r).toEqual({ id: 101, registerNo: "BAP-1998-001" })
  })

  it("returns the validation message for a future date", async () => {
    as("ADMIN")
    const r = await createSacramentRecord(undefined, form({ ...BAPTISM, date: "2026-11-15" }))
    expect(r).toEqual({ error: "The date cannot be in the future." })
    expect(p.$transaction).not.toHaveBeenCalled()
  })

  it("allows an archived person (transcribed historic entry)", async () => {
    as("ADMIN")
    p.person.findUnique.mockResolvedValue({ id: 5 })
    expect(await createSacramentRecord(undefined, form(BAPTISM))).toEqual({ id: 101, registerNo: "BAP-2026-014" })
    expect(p.person.findUnique).toHaveBeenCalledWith({ where: { id: 5 }, select: { id: true } })
  })

  it("rejects a missing person without numbering", async () => {
    as("ADMIN")
    p.person.findUnique.mockResolvedValue(null)
    expect(await createSacramentRecord(undefined, form(BAPTISM))).toEqual({ error: "Person not found." })
    expect(p.sacramentCounter.upsert).not.toHaveBeenCalled()
  })

  it("links a CRM spouse on a marriage after checking they exist", async () => {
    as("PASTOR")
    p.person.findUnique.mockResolvedValueOnce({ archivedAt: null }).mockResolvedValueOnce(null)
    const r = await createSacramentRecord(undefined, form({ type: "MARRIAGE", personId: "5", spouseId: "6", date: "2026-02-01", place: "x" }))
    expect(r).toEqual({ error: "Spouse not found." })
    expect(p.sacramentRecord.create).not.toHaveBeenCalled()
  })

  it("encrypts a free-text spouse name", async () => {
    as("ADMIN")
    p.sacramentCounter.upsert.mockResolvedValue({ lastSeq: 2 })
    const r = await createSacramentRecord(undefined, form({ type: "MARRIAGE", personId: "5", spouseName: "Out Side", date: "2026-02-01", place: "x" }))
    expect(r).toEqual({ id: 101, registerNo: "MAR-2026-002" })
    expect(p.sacramentRecord.create.mock.calls[0][0].data).toMatchObject({ spouseId: null, spouseName: "enc:Out Side" })
  })

  it("retries a lost counter race (P2002) and succeeds", async () => {
    as("ADMIN")
    p.$transaction
      .mockRejectedValueOnce({ code: "P2002" })
      .mockImplementationOnce((cb: (t: unknown) => unknown) => Promise.resolve(cb(prisma)))
    const r = await createSacramentRecord(undefined, form(BAPTISM))
    expect(r).toEqual({ id: 101, registerNo: "BAP-2026-014" })
    expect(p.$transaction).toHaveBeenCalledTimes(2)
  })

  it("gives up with a retry message after repeated conflicts", async () => {
    as("ADMIN")
    p.$transaction.mockRejectedValue({ code: "P2034" })
    const r = await createSacramentRecord(undefined, form(BAPTISM))
    expect(r).toEqual({ error: expect.stringContaining("try again") })
    expect(p.$transaction).toHaveBeenCalledTimes(3)
  })

  it("maps a person or spouse deleted mid-create (P2003) to not found", async () => {
    as("ADMIN")
    p.$transaction.mockRejectedValue({ code: "P2003" })
    expect(await createSacramentRecord(undefined, form(BAPTISM))).toEqual({ error: "Person or spouse not found." })
  })

  it("rolls back and reports when the audit write fails", async () => {
    as("ADMIN")
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("db down"))
    const r = await createSacramentRecord(undefined, form(BAPTISM))
    expect(r).toEqual({ error: expect.stringContaining("audit log") })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("updateSacramentRecord", () => {
  const EDIT = { date: "2026-04-01", place: "St Mark", ministerName: "Fr A", notes: "edited" }

  it("logs and rethrows an unexpected error", async () => {
    as("ADMIN")
    p.$transaction.mockRejectedValue(new Error("boom"))
    await expect(updateSacramentRecord(7, undefined, form(EDIT))).rejects.toThrow("boom")
    expect(logger.error).toHaveBeenCalledWith("updateSacramentRecord failed", { name: "Error" })
  })

  it.each(["ADMIN", "PASTOR"])("%s edits and audits without PII in metadata", async (role) => {
    as(role)
    const r = await updateSacramentRecord(7, undefined, form(EDIT))
    expect(r).toEqual({ success: "BAP-2026-003 saved." })
    expect(p.sacramentRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 7, type: "BAPTISM", personId: 5 },
      data: expect.objectContaining({ date: new Date("2026-04-01T00:00:00.000Z"), ministerName: "Fr A", notes: "enc:edited" }),
    })
    const meta = (logAuditTx as jest.Mock).mock.calls[0][5]
    expect(meta).toEqual({ registerNo: "BAP-2026-003", type: "BAPTISM", personId: 5, spouseId: null })
  })

  it.each([...NON_EDITORS, null])("rejects %s", async (role) => {
    as(role)
    expect(await updateSacramentRecord(7, undefined, form(EDIT))).toEqual({ error: "Unauthorized" })
    expect(p.sacramentRecord.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a malformed id", async () => {
    as("ADMIN")
    expect(await updateSacramentRecord(0, undefined, form(EDIT))).toEqual({ error: "Record not found." })
  })

  it("refuses to move the date out of the numbered year", async () => {
    as("ADMIN")
    const r = await updateSacramentRecord(7, undefined, form({ ...EDIT, date: "2025-12-31" }))
    expect(r).toEqual({ error: expect.stringContaining("must stay in that year") })
    expect(p.sacramentRecord.updateMany).not.toHaveBeenCalled()
  })

  it("applies the marriage spouse rules to the stored rite", async () => {
    as("ADMIN")
    const r = await updateSacramentRecord(7, undefined, form({ ...EDIT, spouseName: "X" }))
    expect(r).toEqual({ error: "A spouse can only be recorded for a marriage." })
  })

  it("reports a stale edit when updatedAt no longer matches", async () => {
    as("ADMIN")
    p.sacramentRecord.updateMany.mockResolvedValue({ count: 0 })
    const r = await updateSacramentRecord(7, undefined, form({ ...EDIT, updatedAt: "2026-05-01T00:00:00.000Z" }))
    expect(r).toEqual({ error: expect.stringContaining("changed since") })
    expect(p.sacramentRecord.updateMany.mock.calls[0][0].where).toMatchObject({ updatedAt: new Date("2026-05-01T00:00:00.000Z") })
    expect(logAuditTx).not.toHaveBeenCalled()
  })

  it("returns not found for a missing record", async () => {
    as("ADMIN")
    p.sacramentRecord.findUnique.mockResolvedValue(null)
    expect(await updateSacramentRecord(7, undefined, form(EDIT))).toEqual({ error: "Record not found." })
  })
})

describe("deleteSacramentRecord", () => {
  it("logs and rethrows an unexpected error", async () => {
    as("ADMIN")
    p.$transaction.mockRejectedValue(new Error("boom"))
    await expect(deleteSacramentRecord(7)).rejects.toThrow("boom")
    expect(logger.error).toHaveBeenCalledWith("deleteSacramentRecord failed", { name: "Error" })
  })

  it.each(["ADMIN", "PASTOR"])("%s deletes and audits the register number", async (role) => {
    as(role)
    expect(await deleteSacramentRecord(7)).toEqual({ success: "BAP-2026-003 deleted." })
    expect(p.sacramentRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 7 } })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 9, "SACRAMENT_RECORD_DELETED", "SacramentRecord", 7, {
      registerNo: "BAP-2026-003",
      type: "BAPTISM",
      personId: 5,
      spouseId: null,
    })
  })

  it.each([...NON_EDITORS, null])("rejects %s", async (role) => {
    as(role)
    expect(await deleteSacramentRecord(7)).toEqual({ error: "Unauthorized" })
    expect(p.sacramentRecord.deleteMany).not.toHaveBeenCalled()
  })

  it("returns not found when the row vanished before the delete", async () => {
    as("ADMIN")
    p.sacramentRecord.deleteMany.mockResolvedValue({ count: 0 })
    expect(await deleteSacramentRecord(7)).toEqual({ error: "Record not found." })
    expect(logAuditTx).not.toHaveBeenCalled()
  })
})

describe("getSacramentRecord", () => {
  const ROW = {
    id: 7,
    type: "MARRIAGE",
    registerNo: "MAR-2026-001",
    date: new Date("2026-02-01T00:00:00.000Z"),
    place: "St Mark",
    ministerName: null,
    spouseName: "enc:Out Side",
    godparents: null,
    notes: "enc:n",
    updatedAt: new Date("2026-02-02T00:00:00.000Z"),
    person: { id: 5, firstName: "A", lastName: "B" },
    spouse: null,
  }

  it.each(["ADMIN", "PASTOR", "OFFICE_ADMIN"])("%s reads a decrypted record", async (role) => {
    as(role)
    p.sacramentRecord.findUnique.mockResolvedValue(ROW)
    const r = await getSacramentRecord(7)
    expect(r).toMatchObject({ registerNo: "MAR-2026-001", date: "2026-02-01", spouseName: "Out Side", notes: "n", godparents: null })
  })

  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER", "HEADMASTER", "TEACHER", null])("denies %s", async (role) => {
    as(role)
    expect(await getSacramentRecord(7)).toBeNull()
    expect(p.sacramentRecord.findUnique).not.toHaveBeenCalled()
  })

  it("returns null for a missing record", async () => {
    as("OFFICE_ADMIN")
    p.sacramentRecord.findUnique.mockResolvedValue(null)
    expect(await getSacramentRecord(7)).toBeNull()
  })
})

describe("searchSacramentPeople", () => {
  it.each(["ADMIN", "PASTOR"])("%s gets id and display names, ANDing the words", async (role) => {
    as(role)
    p.person.findMany.mockResolvedValue([{ id: 4, firstName: "Alex", lastName: "Sample", family: { name: "Sample Family" } }])
    expect(await searchSacramentPeople("alex sam")).toEqual([{ id: 4, name: "Alex Sample", familyName: "Sample Family" }])
    const arg = p.person.findMany.mock.calls[0][0]
    expect(arg.where.archivedAt).toBeNull()
    expect(arg.where.AND).toHaveLength(2)
    expect(arg.take).toBe(20)
  })

  it.each(["OFFICE_ADMIN", "VIEWER", "AUDITOR", "EVENT_ORGANISER", "HEADMASTER", "TEACHER", null])(
    "returns nothing for %s without querying",
    async (role) => {
      as(role)
      expect(await searchSacramentPeople("alex")).toEqual([])
      expect(p.person.findMany).not.toHaveBeenCalled()
    },
  )

  it("returns nothing for a blank query", async () => {
    as("ADMIN")
    expect(await searchSacramentPeople("   ")).toEqual([])
    expect(p.person.findMany).not.toHaveBeenCalled()
  })
})
