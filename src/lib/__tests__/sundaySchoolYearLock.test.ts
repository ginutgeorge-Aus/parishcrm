/**
 * @jest-environment node
 */
import type { Prisma } from "@/lib/generated/prisma/client"

jest.mock("@/lib/prisma", () => ({ prisma: {} }))

import { blockYearClosers, lockedYearRefs } from "@/lib/sundaySchoolYearLock"

describe("blockYearClosers", () => {
  it("takes ROW EXCLUSIVE on the class, teacher and enrolment tables", async () => {
    const executeRaw = jest.fn().mockResolvedValue(0)
    const tx = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient

    await blockYearClosers(tx)

    expect(executeRaw).toHaveBeenCalledTimes(1)
    const sql = (executeRaw.mock.calls[0][0] as TemplateStringsArray).join("?")
    expect(sql).toBe(
      'LOCK TABLE "SundaySchoolClass", "SundaySchoolTeacher", "SundaySchoolEnrolment" IN ROW EXCLUSIVE MODE',
    )
  })
})

describe("lockedYearRefs", () => {
  const mkTx = (years: number[], counts: [number, number, number, number]) => ({
    sundaySchoolYearLock: { findMany: jest.fn().mockResolvedValue(years.map((year) => ({ year }))) },
    sundaySchoolTeacher: { count: jest.fn().mockResolvedValue(counts[0]) },
    sundaySchoolEnrolment: { count: jest.fn().mockResolvedValue(counts[1]) },
    sundaySchoolAttendance: { count: jest.fn().mockResolvedValue(counts[2]) },
    sundaySchoolExamResult: { count: jest.fn().mockResolvedValue(counts[3]) },
  })

  it("counts exam results in locked years, so a person delete can't cascade locked marks", async () => {
    const tx = mkTx([2025], [0, 0, 0, 2])
    expect(await lockedYearRefs(tx as unknown as Prisma.TransactionClient, 7)).toBe(2)
    expect(tx.sundaySchoolExamResult.count).toHaveBeenCalledWith({ where: { personId: 7, exam: { year: { in: [2025] } } } })
  })

  it("sums every kind of locked-year row", async () => {
    const tx = mkTx([2024, 2025], [1, 2, 3, 4])
    expect(await lockedYearRefs(tx as unknown as Prisma.TransactionClient, 7)).toBe(10)
  })

  it("returns 0 without counting when no year is locked", async () => {
    const tx = mkTx([], [1, 1, 1, 1])
    expect(await lockedYearRefs(tx as unknown as Prisma.TransactionClient, 7)).toBe(0)
    expect(tx.sundaySchoolExamResult.count).not.toHaveBeenCalled()
  })
})
