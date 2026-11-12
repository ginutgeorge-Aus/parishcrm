/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    sundaySchoolClass: { findFirst: jest.fn() },
    sundaySchoolExam: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    sundaySchoolExamResult: { upsert: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/sundaySchoolAccess", () => ({ canMarkExam: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { canMarkExam } from "@/lib/sundaySchoolAccess"
import { createExam, updateExam, archiveExam, setExamScore } from "@/lib/actions/sundaySchoolExam"

const as = (role: UserRole) => (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
const p = prisma as unknown as {
  sundaySchoolClass: { findFirst: jest.Mock }
  sundaySchoolExam: { findFirst: jest.Mock; create: jest.Mock; updateMany: jest.Mock; count: jest.Mock }
  sundaySchoolExamResult: { upsert: jest.Mock; deleteMany: jest.Mock; count: jest.Mock }
  $queryRaw: jest.Mock
}
const LOCKED = "This school year is locked — it can no longer be changed"
/** Lock queries: class live, year lock, exam row (total as locked in-tx), enrolment rows. */
const locks = (enrolled: number[], yearLocked = false, lockedTotal: string | null = "100.00") =>
  p.$queryRaw.mockImplementation((sql: TemplateStringsArray) => {
    const q = sql.join("?")
    if (q.includes('FROM "SundaySchoolYearLock"')) return Promise.resolve(yearLocked ? [{ year: 2026 }] : [])
    if (q.includes('FROM "SundaySchoolClass"')) return Promise.resolve([{ id: 4, year: 2026 }])
    if (q.includes('FROM "SundaySchoolExam"')) return Promise.resolve(lockedTotal === null ? [] : [{ id: 9, totalMarks: lockedTotal }])
    return Promise.resolve(enrolled.map((personId) => ({ personId })))
  })
const form = (o: Record<string, string> = {}) => {
  const f = new FormData()
  for (const [k, v] of Object.entries({ name: "Term 1", date: "2026-03-01", totalMarks: "100", ...o })) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.ADMIN)
  ;(canMarkExam as jest.Mock).mockResolvedValue(true)
  p.sundaySchoolClass.findFirst.mockResolvedValue({ id: 4, year: 2026 })
  p.sundaySchoolExam.findFirst.mockResolvedValue({ id: 9, classId: 4, totalMarks: { toString: () => "100.00" } })
  p.sundaySchoolExam.create.mockResolvedValue({ id: 9 })
  p.sundaySchoolExam.updateMany.mockResolvedValue({ count: 1 })
  p.sundaySchoolExam.count.mockResolvedValue(0)
  p.sundaySchoolExamResult.count.mockResolvedValue(0)
  locks([3])
})

describe("setExamScore", () => {
  it("stores 0 as a real row with markedById", async () => {
    expect(await setExamScore(9, 3, "0")).toBeUndefined()
    expect(p.sundaySchoolExamResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { examId: 9, personId: 3, score: "0", markedById: 1 },
      update: { score: "0", markedById: 1 },
    }))
    expect(logAudit).toHaveBeenCalledWith(1, "SS_EXAM_SCORE_SET", "SundaySchoolExam", 9, { personId: 3, cleared: false })
  })
  it("rejects negative, over total, >2dp, non-numeric", async () => {
    for (const bad of ["-1", "101", "7.555", "abc"]) {
      expect(await setExamScore(9, 3, bad)).toMatchObject({ error: expect.any(String) })
    }
    expect(p.sundaySchoolExamResult.upsert).not.toHaveBeenCalled()
  })
  it("blank clears (deletes the row)", async () => {
    expect(await setExamScore(9, 3, "")).toBeUndefined()
    expect(p.sundaySchoolExamResult.deleteMany).toHaveBeenCalledWith({ where: { examId: 9, personId: 3 } })
    expect(p.sundaySchoolExamResult.upsert).not.toHaveBeenCalled()
  })
  it("stores a leading-zero score normalised", async () => {
    expect(await setExamScore(9, 3, "0000012")).toBeUndefined()
    expect(p.sundaySchoolExamResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { score: "12", markedById: 1 },
    }))
  })
  it("re-checks the score against the total locked in the transaction (concurrent lower)", async () => {
    // Guard read 100, but updateExam committed a total of 10 before our FOR SHARE.
    locks([3], false, "10.00")
    expect(await setExamScore(9, 3, "50")).toEqual({ error: "Score cannot be more than the total (10.00)" })
    expect(p.sundaySchoolExamResult.upsert).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
    const examLock = p.$queryRaw.mock.calls.map(([sql]) => (sql as TemplateStringsArray).join("?"))
      .find((q) => q.includes('FROM "SundaySchoolExam"'))
    expect(examLock).toContain("FOR SHARE")
  })
  it("exam archived after the guard gives Exam not found", async () => {
    locks([3], false, null)
    expect(await setExamScore(9, 3, "5")).toEqual({ error: "Exam not found" })
    expect(p.sundaySchoolExamResult.upsert).not.toHaveBeenCalled()
  })
  it("rejects an unenrolled child", async () => {
    locks([])
    expect(await setExamScore(9, 3, "5")).toEqual({ error: "Child is not in this class" })
    expect(p.sundaySchoolExamResult.upsert).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })
  it("rejects a locked year", async () => {
    locks([3], true)
    expect(await setExamScore(9, 3, "5")).toEqual({ error: LOCKED })
    expect(p.sundaySchoolExamResult.upsert).not.toHaveBeenCalled()
    expect(p.sundaySchoolExamResult.deleteMany).not.toHaveBeenCalled()
  })
  it("rejects a teacher of another class", async () => {
    as(UserRole.TEACHER)
    ;(canMarkExam as jest.Mock).mockResolvedValue(false)
    expect(await setExamScore(9, 3, "5")).toEqual({ error: "Unauthorized" })
    expect(canMarkExam).toHaveBeenCalledWith(1, 4, UserRole.TEACHER)
    expect(p.sundaySchoolExamResult.upsert).not.toHaveBeenCalled()
  })
  it("rejects VIEWER and unknown exam", async () => {
    as(UserRole.VIEWER)
    expect(await setExamScore(9, 3, "5")).toEqual({ error: "Unauthorized" })
    as(UserRole.ADMIN)
    p.sundaySchoolExam.findFirst.mockResolvedValue(null)
    expect(await setExamScore(9, 3, "5")).toEqual({ error: "Exam not found" })
  })
})

describe("createExam / updateExam / archiveExam", () => {
  it("creates with the class year and audits", async () => {
    expect(await createExam(4, undefined, form())).toBeUndefined()
    expect(p.sundaySchoolExam.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { classId: 4, year: 2026, name: "Term 1", date: new Date("2026-03-01T00:00:00.000Z"), totalMarks: "100" },
    }))
    expect(logAudit).toHaveBeenCalledWith(1, "SS_EXAM_CREATED", "SundaySchoolExam", 9, expect.any(Object))
  })
  it("normalises a leading-zero total", async () => {
    expect(await createExam(4, undefined, form({ totalMarks: "0000100" }))).toBeUndefined()
    expect(p.sundaySchoolExam.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalMarks: "100" }) }))
  })
  it("rejects a duplicate name+date under the class FOR UPDATE lock", async () => {
    p.sundaySchoolExam.count.mockResolvedValue(1)
    expect(await createExam(4, undefined, form())).toEqual({ error: "This class already has an exam with that name on that date" })
    expect(p.sundaySchoolExam.count).toHaveBeenCalledWith({
      where: { classId: 4, year: 2026, name: { equals: "Term 1", mode: "insensitive" }, date: new Date("2026-03-01T00:00:00.000Z"), archivedAt: null },
    })
    expect(p.sundaySchoolExam.create).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
    const classLock = p.$queryRaw.mock.calls.map(([sql]) => (sql as TemplateStringsArray).join("?"))
      .find((q) => q.includes('FROM "SundaySchoolClass"'))
    expect(classLock).toContain("FOR UPDATE")
  })
  it("rejects bad form, date outside year, locked year, other-class teacher", async () => {
    expect(await createExam(4, undefined, form({ name: "" }))).toMatchObject({ error: expect.any(String) })
    expect(await createExam(4, undefined, form({ date: "2025-03-01" }))).toMatchObject({ error: expect.stringContaining("2026") })
    locks([3], true)
    expect(await createExam(4, undefined, form())).toEqual({ error: LOCKED })
    as(UserRole.TEACHER)
    ;(canMarkExam as jest.Mock).mockResolvedValue(false)
    expect(await createExam(4, undefined, form())).toEqual({ error: "Unauthorized" })
    expect(p.sundaySchoolExam.create).not.toHaveBeenCalled()
  })
  it("update locks the exam row FOR UPDATE before counting scores", async () => {
    expect(await updateExam(9, undefined, form())).toBeUndefined()
    const order = p.$queryRaw.mock.calls.map(([sql]) => (sql as TemplateStringsArray).join("?"))
    const i = order.findIndex((q) => q.includes('FROM "SundaySchoolExam"'))
    expect(order[i]).toContain("FOR UPDATE")
    expect(p.$queryRaw.mock.invocationCallOrder[i]).toBeLessThan(p.sundaySchoolExamResult.count.mock.invocationCallOrder[0])
  })
  it("update of an exam archived after the guard gives Exam not found", async () => {
    locks([3], false, null)
    expect(await updateExam(9, undefined, form())).toEqual({ error: "Exam not found" })
    expect(p.sundaySchoolExam.updateMany).not.toHaveBeenCalled()
  })
  it("update refuses a total below an entered score", async () => {
    p.sundaySchoolExamResult.count.mockResolvedValue(1)
    expect(await updateExam(9, undefined, form({ totalMarks: "10" }))).toEqual({ error: "Total marks is below a score already entered" })
    expect(p.sundaySchoolExam.updateMany).not.toHaveBeenCalled()
  })
  it("update and archive succeed and audit; locked year refused", async () => {
    expect(await updateExam(9, undefined, form())).toBeUndefined()
    expect(await archiveExam(9)).toBeUndefined()
    expect(logAudit).toHaveBeenCalledWith(1, "SS_EXAM_UPDATED", "SundaySchoolExam", 9, expect.any(Object))
    expect(logAudit).toHaveBeenCalledWith(1, "SS_EXAM_ARCHIVED", "SundaySchoolExam", 9, expect.any(Object))
    jest.clearAllMocks()
    locks([3], true)
    expect(await archiveExam(9)).toEqual({ error: LOCKED })
    expect(p.sundaySchoolExam.updateMany).not.toHaveBeenCalled()
  })
})
