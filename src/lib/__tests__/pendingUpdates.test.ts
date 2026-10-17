/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    familyUpdateSubmission: { count: jest.fn().mockResolvedValue(2) },
    membershipApplication: { count: jest.fn().mockResolvedValue(3) },
  },
}))

import { prisma } from "@/lib/prisma"
import { countPendingFamilyUpdates, countPendingMemberships } from "@/lib/pendingUpdates"

describe("pending counts", () => {
  it("counts pending family updates for non-archived families", async () => {
    await expect(countPendingFamilyUpdates()).resolves.toBe(2)
    expect(prisma.familyUpdateSubmission.count).toHaveBeenCalledWith({
      where: { status: "PENDING", family: { archivedAt: null } },
    })
  })

  it("counts PENDING membership applications", async () => {
    await expect(countPendingMemberships()).resolves.toBe(3)
    expect(prisma.membershipApplication.count).toHaveBeenCalledWith({ where: { status: "PENDING" } })
  })
})
