/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    sundaySchoolClass: { findFirst: jest.fn() },
    sundaySchoolSession: { findUnique: jest.fn(), createMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    sundaySchoolAttendance: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    sundaySchoolRollMarker: { create: jest.fn(), deleteMany: jest.fn() },
    user: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/sundaySchoolAccess", () => ({ canMarkRoll: jest.fn() }))
jest.mock("@/lib/dates", () => ({ sydneyTodayYMD: () => "2026-10-11" }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { revalidatePath } from "next/cache"
import { canMarkRoll } from "@/lib/sundaySchoolAccess"
import { setAttendance, markUnmarkedPresent, addRollMarker, removeRollMarker } from "@/lib/actions/sundaySchoolAttendance"

const as = (role: UserRole) => (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
const p = prisma as unknown as {
  sundaySchoolClass: { findFirst: jest.Mock }
  sundaySchoolSession: { findUnique: jest.Mock; createMany: jest.Mock; findUniqueOrThrow: jest.Mock }
  sundaySchoolAttendance: { findUnique: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock }
  sundaySchoolRollMarker: { create: jest.Mock; deleteMany: jest.Mock }
  user: { findFirst: jest.Mock }
  $queryRaw: jest.Mock
}
/** Lock queries: class row found; `enrolled` = person ids the enrolment lock returns. */
const locks = (enrolled: number[], classLive = true) =>
  p.$queryRaw.mockImplementation((sql: TemplateStringsArray) =>
    Promise.resolve(sql.join("?").includes('FROM "SundaySchoolClass"')
      ? (classLive ? [{ id: 4 }] : [])
      : enrolled.map((personId) => ({ personId }))))

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.ADMIN)
  ;(canMarkRoll as jest.Mock).mockResolvedValue(true)
  p.sundaySchoolClass.findFirst.mockResolvedValue({ year: 2026, id: 4 })
  p.sundaySchoolSession.findUnique.mockResolvedValue(null)
  p.sundaySchoolSession.findUniqueOrThrow.mockResolvedValue({ id: 55 })
  locks([3])
})

describe("roll guards", () => {
  it("refuses when canMarkRoll is false, without writes", async () => {
    as(UserRole.EVENT_ORGANISER)
    ;(canMarkRoll as jest.Mock).mockResolvedValue(false)
    expect(await setAttendance(4, "2026-10-11", 3, "PRESENT")).toEqual({ error: "Unauthorized" })
    expect(await markUnmarkedPresent(4, "2026-10-11")).toEqual({ error: "Unauthorized" })
    expect(canMarkRoll).toHaveBeenCalledWith(1, 4, UserRole.EVENT_ORGANISER)
    expect(p.sundaySchoolAttendance.upsert).not.toHaveBeenCalled()
    expect(p.sundaySchoolAttendance.createMany).not.toHaveBeenCalled()
  })
  it("refuses a signed-out user", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    expect(await setAttendance(4, "2026-10-11", 3, "PRESENT")).toEqual({ error: "Unauthorized" })
    expect(canMarkRoll).not.toHaveBeenCalled()
  })
  it("blocks the live demo before auth", async () => {
    ;(assertNotDemo as jest.Mock).mockReturnValueOnce({ error: "Disabled in the live demo" })
    expect(await setAttendance(4, "2026-10-11", 3, "PRESENT")).toEqual({ error: "Disabled in the live demo" })
    expect(auth).not.toHaveBeenCalled()
  })
  it("rejects an archived or missing class", async () => {
    p.sundaySchoolClass.findFirst.mockResolvedValue(null)
    expect(await setAttendance(4, "2026-10-11", 3, "PRESENT")).toEqual({ error: "Class not found" })
    expect(p.sundaySchoolClass.findFirst.mock.calls[0][0].where).toEqual({ id: 4, archivedAt: null })
  })
  it("rejects a class archived after the guard (lock finds no live row)", async () => {
    locks([3], false)
    expect(await setAttendance(4, "2026-10-11", 3, "PRESENT")).toEqual({ error: "Class not found" })
    expect(p.sundaySchoolAttendance.upsert).not.toHaveBeenCalled()
  })
  it.each([
    ["2026-10-12", "Can't take a roll for a future date"],
    ["2025-12-28", "This class is for 2026"],
    ["2026-13-01", "Invalid date"],
    ["", "Invalid date"],
  ])("date %s → %s", async (ymd, error) => {
    expect(await setAttendance(4, ymd, 3, "PRESENT")).toEqual({ error })
    expect(await markUnmarkedPresent(4, ymd)).toEqual({ error })
  })
  it("rejects an unknown status and bad ids", async () => {
    expect(await setAttendance(4, "2026-10-11", 3, "HERE" as never)).toEqual({ error: "Invalid status" })
    expect(await setAttendance(4, "2026-10-11", 0, "PRESENT")).toEqual({ error: "Invalid person" })
    expect(await setAttendance(-1, "2026-10-11", 3, "PRESENT")).toEqual({ error: "Invalid class" })
  })
})

describe("setAttendance", () => {
  it("refuses a child not enrolled and never marked", async () => {
    locks([])
    expect(await setAttendance(4, "2026-10-11", 3, "PRESENT")).toEqual({ error: "Child is not in this class" })
    expect(p.sundaySchoolAttendance.upsert).not.toHaveBeenCalled()
  })
  it("allows correcting a prior mark for a child since moved out", async () => {
    locks([])
    p.sundaySchoolSession.findUnique.mockResolvedValue({ id: 55 })
    p.sundaySchoolAttendance.findUnique.mockResolvedValue({ id: 9 })
    expect(await setAttendance(4, "2026-10-04", 3, "ABSENT")).toBeUndefined()
    expect(p.sundaySchoolAttendance.findUnique).toHaveBeenCalledWith({
      where: { sessionId_personId: { sessionId: 55, personId: 3 } }, select: { id: true },
    })
    expect(p.sundaySchoolAttendance.upsert).toHaveBeenCalled()
  })
  it("creates the session lazily and upserts the mark", async () => {
    expect(await setAttendance(4, "2026-10-11", 3, "PRESENT")).toBeUndefined()
    const date = new Date("2026-10-11T00:00:00.000Z")
    expect(p.sundaySchoolSession.createMany).toHaveBeenCalledWith({ data: [{ classId: 4, date }], skipDuplicates: true })
    expect(p.sundaySchoolSession.findUniqueOrThrow).toHaveBeenCalledWith({ where: { classId_date: { classId: 4, date } }, select: { id: true } })
    expect(p.sundaySchoolAttendance.upsert).toHaveBeenCalledWith({
      where: { sessionId_personId: { sessionId: 55, personId: 3 } },
      create: { sessionId: 55, personId: 3, status: "PRESENT", markedById: 1 },
      update: { status: "PRESENT", markedById: 1 },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "SS_ATTENDANCE_MARKED", "SundaySchoolClass", 4, { date: "2026-10-11", personId: 3, status: "PRESENT" })
    expect(revalidatePath).toHaveBeenCalledWith("/sunday-school/4/roll")
    expect(revalidatePath).toHaveBeenCalledWith("/my-classes/4/roll")
  })
  it("reuses an existing session", async () => {
    p.sundaySchoolSession.findUnique.mockResolvedValue({ id: 77 })
    await setAttendance(4, "2026-10-11", 3, "LATE")
    expect(p.sundaySchoolSession.createMany).not.toHaveBeenCalled()
    expect(p.sundaySchoolAttendance.upsert.mock.calls[0][0].where).toEqual({ sessionId_personId: { sessionId: 77, personId: 3 } })
  })
  it("clearing with no session is a no-op success", async () => {
    expect(await setAttendance(4, "2026-10-11", 3, null)).toBeUndefined()
    expect(p.sundaySchoolSession.createMany).not.toHaveBeenCalled()
    expect(p.sundaySchoolAttendance.deleteMany).not.toHaveBeenCalled()
  })
  it("clearing deletes the mark", async () => {
    p.sundaySchoolSession.findUnique.mockResolvedValue({ id: 55 })
    expect(await setAttendance(4, "2026-10-11", 3, null)).toBeUndefined()
    expect(p.sundaySchoolAttendance.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 55, personId: 3 } })
    expect(p.sundaySchoolAttendance.upsert).not.toHaveBeenCalled()
  })
})

describe("markUnmarkedPresent", () => {
  it("creates marks for enrolled children only, skipping existing", async () => {
    locks([3, 5])
    p.sundaySchoolAttendance.createMany.mockResolvedValue({ count: 2 })
    expect(await markUnmarkedPresent(4, "2026-10-11")).toEqual({ success: "Marked 2 present" })
    expect(p.sundaySchoolAttendance.createMany).toHaveBeenCalledWith({
      data: [
        { sessionId: 55, personId: 3, status: "PRESENT", markedById: 1 },
        { sessionId: 55, personId: 5, status: "PRESENT", markedById: 1 },
      ],
      skipDuplicates: true,
    })
    expect(logAudit).toHaveBeenCalledWith(1, "SS_ATTENDANCE_BULK_PRESENT", "SundaySchoolClass", 4, { date: "2026-10-11", count: 2 })
  })
  it("an empty class creates no session", async () => {
    locks([])
    expect(await markUnmarkedPresent(4, "2026-10-11")).toEqual({ success: "Marked 0 present" })
    expect(p.sundaySchoolSession.createMany).not.toHaveBeenCalled()
    expect(p.sundaySchoolAttendance.createMany).not.toHaveBeenCalled()
  })
})

describe("roll markers", () => {
  it.each([UserRole.EVENT_ORGANISER, UserRole.VIEWER, UserRole.AUDITOR])("%s cannot assign", async (role) => {
    as(role)
    expect(await addRollMarker(4, 9)).toEqual({ error: "Unauthorized" })
    expect(await removeRollMarker(4, 9)).toEqual({ error: "Unauthorized" })
    expect(p.sundaySchoolRollMarker.create).not.toHaveBeenCalled()
    expect(p.sundaySchoolRollMarker.deleteMany).not.toHaveBeenCalled()
  })
  it("refuses a non-organiser or archived target", async () => {
    as(UserRole.OFFICE_ADMIN)
    p.user.findFirst.mockResolvedValueOnce({ role: UserRole.VIEWER }).mockResolvedValueOnce(null)
    expect(await addRollMarker(4, 9)).toEqual({ error: "User is not an event organiser" })
    expect(await addRollMarker(4, 9)).toEqual({ error: "User not found" })
    expect(p.user.findFirst.mock.calls[0][0].where).toEqual({ id: 9, archivedAt: null })
  })
  it("assigns an organiser; duplicate is success", async () => {
    p.user.findFirst.mockResolvedValue({ role: UserRole.EVENT_ORGANISER })
    p.sundaySchoolRollMarker.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }))
    expect(await addRollMarker(4, 9)).toBeUndefined()
    expect(logAudit).toHaveBeenCalledWith(1, "SS_ROLL_MARKER_ADDED", "SundaySchoolClass", 4, { targetUserId: 9 })
    expect(revalidatePath).toHaveBeenCalledWith("/my-classes")
  })
  it("removes with deleteMany", async () => {
    expect(await removeRollMarker(4, 9)).toBeUndefined()
    expect(p.sundaySchoolRollMarker.deleteMany).toHaveBeenCalledWith({ where: { classId: 4, userId: 9 } })
    expect(logAudit).toHaveBeenCalledWith(1, "SS_ROLL_MARKER_REMOVED", "SundaySchoolClass", 4, { targetUserId: 9 })
  })
})
