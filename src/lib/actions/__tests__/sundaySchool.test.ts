/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    sundaySchoolClass: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), createManyAndReturn: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    sundaySchoolTeacher: { create: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    sundaySchoolEnrolment: { findMany: jest.fn(), upsert: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    person: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  }
  m.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof m) => unknown)(m) : Promise.all(arg as unknown[]))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }) }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { redirect } from "next/navigation"
import {
  addTeacher, enrolChildren, rolloverYear, createClass, updateClass, archiveClass, unenrolChild, removeTeacher,
} from "@/lib/actions/sundaySchool"

const as = (role: UserRole) => (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
const liveClass = () => (prisma.sundaySchoolClass.findFirst as jest.Mock).mockResolvedValue({ id: 1, year: 2026 })
const form = (o: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(o)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: 1 }])
})

describe("guards", () => {
  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER])("%s cannot mutate", async (role) => {
    as(role)
    expect(await archiveClass(1)).toEqual({ error: "Unauthorized" })
    expect(await enrolChildren(1, [2])).toEqual({ error: "Unauthorized" })
    expect(await rolloverYear(2026)).toEqual({ error: "Unauthorized" })
    expect(await createClass(2026, undefined, form({ name: "A", level: "1" }))).toEqual({ error: "Unauthorized" })
    expect(prisma.sundaySchoolEnrolment.upsert).not.toHaveBeenCalled()
    expect(prisma.sundaySchoolClass.create).not.toHaveBeenCalled()
  })
  it("blocks writes in the live demo before touching auth", async () => {
    ;(assertNotDemo as jest.Mock).mockReturnValueOnce({ error: "Disabled in the live demo" })
    expect(await unenrolChild(1, 2)).toEqual({ error: "Disabled in the live demo" })
    expect(auth).not.toHaveBeenCalled()
  })
  it("rejects an archived or missing class", async () => {
    as(UserRole.OFFICE_ADMIN)
    ;(prisma.sundaySchoolClass.findFirst as jest.Mock).mockResolvedValue(null)
    expect(await enrolChildren(1, [2])).toEqual({ error: "Class not found" })
    expect((prisma.sundaySchoolClass.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({ id: 1, archivedAt: null })
  })
  it("rejects a non-positive class id without a query", async () => {
    as(UserRole.ADMIN)
    expect(await removeTeacher(0, 2)).toEqual({ error: "Invalid class" })
    expect(prisma.sundaySchoolClass.findFirst).not.toHaveBeenCalled()
  })
})

describe("createClass", () => {
  it("maps a duplicate to a friendly error", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.create as jest.Mock).mockRejectedValue({ code: "P2002" })
    expect(await createClass(2026, undefined, form({ name: "Kindy", level: "0" }))).toEqual({
      error: "A class with this name and location already exists for that year (it may be archived)",
    })
  })
  it("returns the validation message for a bad level", async () => {
    as(UserRole.ADMIN)
    expect(await createClass(2026, undefined, form({ name: "Kindy", level: "" }))).toEqual({ error: "Level must be a whole number" })
  })
  it("rejects a year out of range", async () => {
    as(UserRole.ADMIN)
    expect(await createClass(1999, undefined, form({ name: "Kindy", level: "0" }))).toEqual({ error: "Invalid school year" })
  })
  it("creates with the bound year, audits and redirects to the new class", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.create as jest.Mock).mockResolvedValue({ id: 5 })
    await expect(createClass(2026, undefined, form({ name: " Kindy ", level: "0", location: "Hall" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(prisma.sundaySchoolClass.create).toHaveBeenCalledWith({
      data: { year: 2026, name: "Kindy", level: 0, location: "Hall" }, select: { id: true },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "SS_CLASS_CREATED", "SundaySchoolClass", 5, expect.any(Object))
    expect(redirect).toHaveBeenCalledWith("/sunday-school/5")
  })
  it("reads the year inside a serializable transaction so a concurrent rollover conflicts", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.create as jest.Mock).mockResolvedValue({ id: 5 })
    await expect(createClass(2026, undefined, form({ name: "Kindy", level: "0" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
    expect(prisma.sundaySchoolClass.count).toHaveBeenCalledWith({ where: { year: 2026 } })
  })
  it("maps a serialization conflict to a retry message", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.create as jest.Mock).mockRejectedValue({ code: "P2034" })
    expect(await createClass(2026, undefined, form({ name: "Kindy", level: "0" }))).toEqual({
      error: "2026 was changed by someone else — try again",
    })
  })
})

describe("updateClass / archiveClass", () => {
  it("updates name/level/location but never the year", async () => {
    as(UserRole.PASTOR)
    liveClass()
    ;(prisma.sundaySchoolClass.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await expect(updateClass(1, undefined, form({ name: "Years 1–2", level: "1", year: "2030" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(prisma.sundaySchoolClass.updateMany).toHaveBeenCalledWith({
      where: { id: 1, archivedAt: null }, data: { name: "Years 1–2", level: 1, location: "" },
    })
  })
  it("refuses an update when the class was archived after the guard", async () => {
    as(UserRole.PASTOR)
    liveClass()
    ;(prisma.sundaySchoolClass.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await updateClass(1, undefined, form({ name: "Years 1–2", level: "1" }))).toEqual({ error: "Class not found" })
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("archives instead of deleting", async () => {
    as(UserRole.ADMIN)
    liveClass()
    ;(prisma.sundaySchoolClass.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    expect(await archiveClass(1)).toBeUndefined()
    expect(prisma.sundaySchoolClass.updateMany).toHaveBeenCalledWith({
      where: { id: 1, archivedAt: null }, data: { archivedAt: expect.any(Date) },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "SS_CLASS_ARCHIVED", "SundaySchoolClass", 1)
  })
  it("does not audit an archive that changed no row", async () => {
    as(UserRole.ADMIN)
    liveClass()
    ;(prisma.sundaySchoolClass.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await archiveClass(1)).toEqual({ error: "Class not found" })
    expect(logAudit).not.toHaveBeenCalled()
  })
})

describe("addTeacher", () => {
  it("requires the SUNDAY_SCHOOL_TEACHER tag", async () => {
    as(UserRole.ADMIN)
    liveClass()
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue(null)
    expect(await addTeacher(1, 5)).toEqual({ error: "Tag this person as a Sunday school teacher first" })
    expect((prisma.person.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
      id: 5, archivedAt: null, ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" },
    })
    expect(prisma.sundaySchoolTeacher.create).not.toHaveBeenCalled()
  })
  it("treats a duplicate assignment as success", async () => {
    as(UserRole.ADMIN)
    liveClass()
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })
    ;(prisma.sundaySchoolTeacher.create as jest.Mock).mockRejectedValue({ code: "P2002" })
    expect(await addTeacher(1, 5)).toBeUndefined()
    expect(logAudit).toHaveBeenCalledWith(1, "SS_TEACHER_ADDED", "SundaySchoolClass", 1, { personId: 5 })
  })
})

describe("enrolChildren", () => {
  it("upserts by personId_year and reports moves", async () => {
    as(UserRole.ADMIN)
    liveClass()
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([{ id: 2 }, { id: 3 }])
    ;(prisma.sundaySchoolEnrolment.findMany as jest.Mock).mockResolvedValue([
      { personId: 3, classId: 9, class: { archivedAt: null } },
      { personId: 2, classId: 8, class: { archivedAt: new Date() } },
    ])
    const r = await enrolChildren(1, [2, 3, 3])
    expect(prisma.sundaySchoolEnrolment.upsert).toHaveBeenCalledTimes(2)
    expect((prisma.sundaySchoolEnrolment.upsert as jest.Mock).mock.calls[1][0]).toEqual({
      where: { personId_year: { personId: 3, year: 2026 } },
      create: { classId: 1, personId: 3, year: 2026 },
      update: { classId: 1 },
    })
    expect(r).toEqual({ success: "Enrolled 2 (1 moved from another class)" })
  })
  it("refuses when the class is archived before the enrolment transaction", async () => {
    as(UserRole.ADMIN)
    liveClass()
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([{ id: 2 }])
    ;(prisma.sundaySchoolEnrolment.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([])
    expect(await enrolChildren(1, [2])).toEqual({ error: "Class not found" })
    expect(prisma.sundaySchoolEnrolment.upsert).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("maps a concurrent enrol race to a retry message", async () => {
    as(UserRole.ADMIN)
    liveClass()
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([{ id: 2 }])
    ;(prisma.sundaySchoolEnrolment.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce({ code: "P2002" })
    expect(await enrolChildren(1, [2])).toEqual({ error: "Someone else just changed these enrolments — try again" })
  })
  it("rejects an unknown or archived person", async () => {
    as(UserRole.ADMIN)
    liveClass()
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([{ id: 2 }])
    expect(await enrolChildren(1, [2, 3])).toEqual({ error: "Person not found" })
    expect(prisma.sundaySchoolEnrolment.upsert).not.toHaveBeenCalled()
  })
  it("rejects more than 200 ids", async () => {
    as(UserRole.ADMIN)
    liveClass()
    const ids = Array.from({ length: 201 }, (_, i) => i + 1)
    expect(await enrolChildren(1, ids)).toEqual({ error: "Too many people at once" })
  })
  it("rejects an empty selection and bad ids", async () => {
    as(UserRole.ADMIN)
    liveClass()
    expect(await enrolChildren(1, [])).toEqual({ error: "Pick at least one child" })
    expect(await enrolChildren(1, [-4])).toEqual({ error: "Invalid person" })
  })
})

describe("unenrolChild / removeTeacher success paths", () => {
  it("deletes the enrolment and audits", async () => {
    as(UserRole.ADMIN); liveClass()
    await unenrolChild(1, 5)
    expect(prisma.sundaySchoolEnrolment.deleteMany).toHaveBeenCalledWith({ where: { classId: 1, personId: 5 } })
    expect(logAudit).toHaveBeenCalledWith(1, "SS_UNENROLLED", "SundaySchoolClass", 1, { personId: 5 })
  })
  it("refuses to unenrol, add or remove a teacher once the class was archived mid-request", async () => {
    as(UserRole.ADMIN); liveClass()
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([])
    expect(await unenrolChild(1, 5)).toEqual({ error: "Class not found" })
    expect(await removeTeacher(1, 7)).toEqual({ error: "Class not found" })
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 7 })
    expect(await addTeacher(1, 7)).toEqual({ error: "Class not found" })
    expect(prisma.sundaySchoolTeacher.create).not.toHaveBeenCalled()
    expect(prisma.sundaySchoolEnrolment.deleteMany).not.toHaveBeenCalled()
    expect(prisma.sundaySchoolTeacher.deleteMany).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("deletes the teacher link and audits", async () => {
    as(UserRole.ADMIN); liveClass()
    await removeTeacher(1, 7)
    expect(prisma.sundaySchoolTeacher.deleteMany).toHaveBeenCalledWith({ where: { classId: 1, personId: 7 } })
    expect(logAudit).toHaveBeenCalledWith(1, "SS_TEACHER_REMOVED", "SundaySchoolClass", 1, { personId: 7 })
  })
})

describe("rolloverYear", () => {
  it("refuses when next year already has classes", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(2)
    expect(await rolloverYear(2026)).toEqual({ error: "2027 already has classes — roll over is one-time" })
    expect(prisma.sundaySchoolClass.create).not.toHaveBeenCalled()
  })
  it("refuses when there is nothing to roll over", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([])
    expect(await rolloverYear(2026)).toEqual({ error: "No classes in 2026 to roll over" })
  })
  it("creates copies, teachers and promoted enrolments in one transaction", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([
      { id: 1, name: "Kindy", level: 0, location: "", teachers: [{ personId: 7 }], enrolments: [{ personId: 10 }] },
      { id: 2, name: "Years 1–2", level: 1, location: "", teachers: [], enrolments: [{ personId: 20 }] },
    ])
    // Returned out of order on purpose: ids are matched by (name, location).
    ;(prisma.sundaySchoolClass.createManyAndReturn as jest.Mock).mockResolvedValue([
      { id: 102, name: "Years 1–2", location: "" }, { id: 101, name: "Kindy", location: "" },
    ])
    ;(prisma.sundaySchoolEnrolment.createMany as jest.Mock).mockResolvedValue({ count: 1 })
    const r = await rolloverYear(2026)
    expect((prisma.sundaySchoolClass.findMany as jest.Mock).mock.calls[0][0].select.teachers.where).toEqual({
      person: { archivedAt: null, ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" } },
    })
    expect(prisma.sundaySchoolClass.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        { year: 2027, name: "Kindy", level: 0, location: "" },
        { year: 2027, name: "Years 1–2", level: 1, location: "" },
      ],
      select: { id: true, name: true, location: true },
    })
    expect(prisma.sundaySchoolTeacher.createMany).toHaveBeenCalledWith({ data: [{ classId: 101, personId: 7 }], skipDuplicates: true })
    expect(prisma.sundaySchoolEnrolment.createMany).toHaveBeenCalledWith({
      data: [{ classId: 102, personId: 10, year: 2027 }], skipDuplicates: true,
    })
    expect(logAudit).toHaveBeenCalledWith(1, "SS_ROLLOVER", "SundaySchoolClass", 101, {
      fromYear: 2026, classes: 2, placed: 1, unplaced: 1,
    })
    expect(r).toEqual({ success: "Created 2 classes for 2027; moved 1 child; 1 need placing by hand" })
  })
  it("counts only enrolments actually written", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([
      { id: 1, name: "C1", level: 0, location: "", teachers: [], enrolments: [{ personId: 10 }, { personId: 11 }] },
      { id: 2, name: "C2", level: 1, location: "", teachers: [], enrolments: [] },
    ])
    ;(prisma.sundaySchoolClass.createManyAndReturn as jest.Mock).mockResolvedValue([
      { id: 101, name: "C1", location: "" }, { id: 102, name: "C2", location: "" },
    ])
    ;(prisma.sundaySchoolEnrolment.createMany as jest.Mock).mockResolvedValue({ count: 1 }) // one already placed
    expect(await rolloverYear(2026)).toEqual({ success: "Created 2 classes for 2027; moved 1 child; 1 need placing by hand" })
  })
  it("counts any class in next year, archived included", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(1)
    await rolloverYear(2026)
    expect(prisma.sundaySchoolClass.count).toHaveBeenCalledWith({ where: { year: 2027 } })
  })
  it("maps a serialization failure to a retry message", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([
      { id: 1, name: "Kindy", level: 0, location: "", teachers: [], enrolments: [] },
    ])
    ;(prisma.sundaySchoolClass.createManyAndReturn as jest.Mock).mockRejectedValueOnce({ code: "P2034" })
    expect(await rolloverYear(2026)).toEqual({ error: "2027 was changed by someone else during roll over — try again" })
  })
  it("maps a unique violation (archived or concurrent copy) to a clear error", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([
      { id: 1, name: "Kindy", level: 0, location: "", teachers: [], enrolments: [] },
    ])
    ;(prisma.sundaySchoolClass.createManyAndReturn as jest.Mock).mockRejectedValueOnce({ code: "P2002" })
    expect(await rolloverYear(2026)).toEqual({
      error: "2027 already has a class with the same name and location (it may be archived) — rename or remove it first",
    })
  })
})
