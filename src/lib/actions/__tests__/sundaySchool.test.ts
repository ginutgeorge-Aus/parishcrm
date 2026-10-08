/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    sundaySchoolClass: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    sundaySchoolTeacher: { create: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    sundaySchoolEnrolment: { findMany: jest.fn(), upsert: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    person: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
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

beforeEach(() => jest.clearAllMocks())

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
})

describe("updateClass / archiveClass", () => {
  it("updates name/level/location but never the year", async () => {
    as(UserRole.PASTOR)
    liveClass()
    await expect(updateClass(1, undefined, form({ name: "Years 1–2", level: "1", year: "2030" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(prisma.sundaySchoolClass.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { name: "Years 1–2", level: 1, location: "" } })
  })
  it("archives instead of deleting", async () => {
    as(UserRole.ADMIN)
    liveClass()
    expect(await archiveClass(1)).toBeUndefined()
    expect(prisma.sundaySchoolClass.updateMany).toHaveBeenCalledWith({
      where: { id: 1, archivedAt: null }, data: { archivedAt: expect.any(Date) },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "SS_CLASS_ARCHIVED", "SundaySchoolClass", 1)
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
    ;(prisma.sundaySchoolEnrolment.findMany as jest.Mock).mockResolvedValue([{ personId: 3, classId: 9 }])
    const r = await enrolChildren(1, [2, 3, 3])
    expect(prisma.sundaySchoolEnrolment.upsert).toHaveBeenCalledTimes(2)
    expect((prisma.sundaySchoolEnrolment.upsert as jest.Mock).mock.calls[1][0]).toEqual({
      where: { personId_year: { personId: 3, year: 2026 } },
      create: { classId: 1, personId: 3, year: 2026 },
      update: { classId: 1 },
    })
    expect(r).toEqual({ success: "Enrolled 2 (1 moved from another class)" })
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
    ;(prisma.sundaySchoolClass.create as jest.Mock)
      .mockResolvedValueOnce({ id: 101 }).mockResolvedValueOnce({ id: 102 })
    const r = await rolloverYear(2026)
    expect(prisma.sundaySchoolClass.create).toHaveBeenNthCalledWith(1, {
      data: { year: 2027, name: "Kindy", level: 0, location: "" }, select: { id: true },
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
  it("maps a concurrent rollover's unique violation to the one-time error", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([
      { id: 1, name: "Kindy", level: 0, location: "", teachers: [], enrolments: [] },
    ])
    ;(prisma.sundaySchoolClass.create as jest.Mock).mockRejectedValueOnce({ code: "P2002" })
    expect(await rolloverYear(2026)).toEqual({ error: "2027 already has classes — roll over is one-time" })
  })
})
