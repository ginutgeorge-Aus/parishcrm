/**
 * @jest-environment node
 */
import type { Prisma } from "@/lib/generated/prisma/client"

jest.mock("@/lib/prisma", () => ({ prisma: {} }))

import { blockYearClosers } from "@/lib/sundaySchoolYearLock"

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
