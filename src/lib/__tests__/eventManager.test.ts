import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/lib/prisma", () => ({
  prisma: { eventManager: { findUnique: jest.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { isEventManager, canManageEvent } from "@/lib/eventManager"

const findUnique = prisma.eventManager.findUnique as jest.Mock

beforeEach(() => findUnique.mockReset())

test("isEventManager true when a link row exists", async () => {
  findUnique.mockResolvedValue({ id: 1 })
  await expect(isEventManager(7, 42)).resolves.toBe(true)
  expect(findUnique).toHaveBeenCalledWith({
    where: { eventId_userId: { eventId: 42, userId: 7 } },
    select: { id: true },
  })
})

test("isEventManager false when no link row", async () => {
  findUnique.mockResolvedValue(null)
  await expect(isEventManager(7, 42)).resolves.toBe(false)
})

test("canManageEvent true for an editor role without a link", async () => {
  findUnique.mockResolvedValue(null)
  await expect(canManageEvent(1, 42, UserRole.ADMIN)).resolves.toBe(true)
  expect(findUnique).not.toHaveBeenCalled()
})

test("canManageEvent true for an assigned organiser", async () => {
  findUnique.mockResolvedValue({ id: 1 })
  await expect(canManageEvent(7, 42, UserRole.EVENT_ORGANISER)).resolves.toBe(true)
})

test("canManageEvent false for an unassigned organiser", async () => {
  findUnique.mockResolvedValue(null)
  await expect(canManageEvent(7, 42, UserRole.EVENT_ORGANISER)).resolves.toBe(false)
})

test("canManageEvent false for a downgraded organiser with a stale link row", async () => {
  // EventManager rows survive a role change; a VIEWER/AUDITOR holding a stale
  // link must NOT reach registrant PII — the current role gates the row.
  findUnique.mockResolvedValue({ id: 1 })
  await expect(canManageEvent(7, 42, UserRole.VIEWER)).resolves.toBe(false)
  await expect(canManageEvent(7, 42, UserRole.AUDITOR)).resolves.toBe(false)
  expect(findUnique).not.toHaveBeenCalled()
})
