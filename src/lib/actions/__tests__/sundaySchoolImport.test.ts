/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    sundaySchoolClass: { findMany: jest.fn() },
    family: { findMany: jest.fn() },
    sundaySchoolEnrolment: { findMany: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() },
    sundaySchoolYearLock: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { commitEnrolmentImport, previewEnrolmentImport } from "@/lib/actions/sundaySchoolImport"

const as = (role: UserRole) => (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
const file = (csv: string) => {
  const fd = new FormData()
  fd.set("file", new File([csv], "e.csv", { type: "text/csv" }))
  return fd
}
const CSV = "family_name,first_name,last_name,class_name\nSmith,Ava,Smith,Kindy\nSmith,Ben,Smith,Kindy"
const LOCKED = "This school year is locked — it can no longer be changed"
let yearLocked = false

/** Row-lock replies: a live class, year lock per `yearLocked`, people echo their ids unless `people` given. */
function locks(people?: unknown[]) {
  ;(prisma.$queryRaw as jest.Mock).mockImplementation((sql: TemplateStringsArray, ...vals: unknown[]) => {
    const q = sql.join("?")
    if (q.includes('FROM "SundaySchoolYearLock"')) return Promise.resolve(yearLocked ? [{ year: 2026 }] : [])
    if (q.includes('FROM "SundaySchoolClass"')) return Promise.resolve([{ id: 5, year: 2026 }])
    if (Array.isArray(vals[0])) return Promise.resolve(people ?? (vals[0] as number[]).map((id) => ({ id })))
    return Promise.resolve([])
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  yearLocked = false
  as(UserRole.ADMIN)
  ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([{ id: 5, name: "Kindy", location: "" }])
  ;(prisma.family.findMany as jest.Mock).mockResolvedValue([
    { id: 1, name: "Smith", people: [{ id: 10, firstName: "Ava", lastName: "Smith" }, { id: 11, firstName: "Ben", lastName: "Smith" }] },
  ])
  ;(prisma.sundaySchoolEnrolment.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.sundaySchoolEnrolment.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  ;(prisma.sundaySchoolEnrolment.createMany as jest.Mock).mockResolvedValue({ count: 2 })
  ;(prisma.sundaySchoolYearLock.findUnique as jest.Mock).mockImplementation(() => Promise.resolve(yearLocked ? { year: 2026 } : null))
  locks()
})

describe("previewEnrolmentImport", () => {
  it.each([UserRole.VIEWER, UserRole.TEACHER, UserRole.AUDITOR])("%s is rejected", async (role) => {
    as(role)
    expect(await previewEnrolmentImport(2026, file(CSV))).toEqual({ error: "Unauthorized" })
    expect(prisma.family.findMany).not.toHaveBeenCalled()
  })
  it("rejects bad year, missing file and a locked year", async () => {
    expect(await previewEnrolmentImport(1999, file(CSV))).toEqual({ error: "Invalid school year" })
    expect(await previewEnrolmentImport(2026, new FormData())).toEqual({ error: "No file provided" })
    yearLocked = true
    expect(await previewEnrolmentImport(2026, file(CSV))).toEqual({ error: LOCKED })
  })
  it("previews unchanged, move and unmatched rows without writing", async () => {
    ;(prisma.sundaySchoolEnrolment.findMany as jest.Mock).mockResolvedValue([{ personId: 10, classId: 5 }, { personId: 11, classId: 9 }])
    const r = await previewEnrolmentImport(2026, file(`${CSV}\nSmith,Zed,Smith,Kindy\nSmith,Ava,Smith,Nope`))
    if (!("preview" in r)) throw new Error("expected preview")
    expect(r.preview.rows.map((x) => x.status)).toEqual(["unchanged", "move", "error"])
    expect(r.preview.parseErrors).toHaveLength(1)
    expect(r.preview.errorCount).toBe(2)
    expect(prisma.sundaySchoolEnrolment.createMany).not.toHaveBeenCalled()
  })
  it("flags a class name shared across locations", async () => {
    ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([{ id: 5, name: "Kindy", location: "A" }, { id: 6, name: "Kindy", location: "B" }])
    const r = await previewEnrolmentImport(2026, file(CSV))
    if (!("preview" in r)) throw new Error("expected preview")
    expect(r.preview.rows[0].message).toMatch(/add a location/)
  })
})

describe("commitEnrolmentImport", () => {
  it("rejects a viewer with no transaction", async () => {
    as(UserRole.VIEWER)
    expect(await commitEnrolmentImport(2026, file(CSV))).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it("enrols, audits inside the transaction and reports counts", async () => {
    expect(await commitEnrolmentImport(2026, file(CSV))).toEqual({ success: "Enrolled 2, moved 0, unchanged 0" })
    expect(prisma.sundaySchoolEnrolment.createMany).toHaveBeenCalledWith({
      data: [{ classId: 5, personId: 10, year: 2026 }, { classId: 5, personId: 11, year: 2026 }],
      skipDuplicates: true,
    })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 1, "SS_ENROL_IMPORTED", "SundaySchoolClass", undefined,
      expect.objectContaining({ year: 2026, enrolled: 2, moved: 0 }))
  })
  it("is idempotent: re-import of enrolled students writes nothing new", async () => {
    ;(prisma.sundaySchoolEnrolment.findMany as jest.Mock).mockResolvedValue([{ personId: 10, classId: 5 }, { personId: 11, classId: 5 }])
    expect(await commitEnrolmentImport(2026, file(CSV))).toEqual({ success: "Enrolled 0, moved 0, unchanged 2" })
    expect(prisma.sundaySchoolEnrolment.createMany).not.toHaveBeenCalled()
    expect(prisma.sundaySchoolEnrolment.updateMany).not.toHaveBeenCalled()
  })
  it("refuses everything when any row has an error", async () => {
    expect(await commitEnrolmentImport(2026, file(`${CSV}\nSmith,Zed,Smith,Kindy`)))
      .toEqual({ error: "Fix the rows with errors first, then upload the file again" })
    expect(prisma.sundaySchoolEnrolment.createMany).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
  })
  it("refuses a locked year", async () => {
    yearLocked = true
    expect(await commitEnrolmentImport(2026, file(CSV))).toEqual({ error: LOCKED })
    expect(prisma.sundaySchoolEnrolment.createMany).not.toHaveBeenCalled()
  })
  it("refuses when a person was archived mid-import", async () => {
    locks([{ id: 10 }])
    expect(await commitEnrolmentImport(2026, file(CSV))).toEqual({ error: "A student was archived while importing — try again" })
    expect(prisma.sundaySchoolEnrolment.createMany).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
  })
})
