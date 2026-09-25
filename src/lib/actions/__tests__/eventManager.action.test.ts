/** @jest-environment node */
// event.ts imports `Prisma` as a VALUE (for Prisma.JsonNull) from the generated
// client, which bootstraps the query engine at module load and crashes under
// jsdom (no TextEncoder). Run this suite under node, same fix as event.test.ts.
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    eventManager: { create: jest.fn(), deleteMany: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { addEventManager, removeEventManager } from "@/lib/actions/eventAccess"
import { setRegistrationClosed } from "@/lib/actions/event"

const mockAuth = auth as unknown as jest.Mock
const asAdmin = () => mockAuth.mockResolvedValue({ user: { id: "1", role: UserRole.ADMIN } })
const asOrganiser = () => mockAuth.mockResolvedValue({ user: { id: "9", role: UserRole.EVENT_ORGANISER } })

beforeEach(() => jest.clearAllMocks())

test("addEventManager rejects non-editors", async () => {
  asOrganiser()
  expect(await addEventManager(42, 7)).toEqual({ error: "Unauthorized" })
  expect(prisma.eventManager.create).not.toHaveBeenCalled()
})

test("addEventManager requires the target to be an EVENT_ORGANISER", async () => {
  asAdmin()
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 42 })
  ;(prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 7, role: UserRole.VIEWER })
  expect(await addEventManager(42, 7)).toEqual({ error: "User is not an event organiser" })
  expect(prisma.eventManager.create).not.toHaveBeenCalled()
})

test("addEventManager creates the link for a valid organiser", async () => {
  asAdmin()
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 42 })
  ;(prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 7, role: UserRole.EVENT_ORGANISER })
  expect(await addEventManager(42, 7)).toBeUndefined()
  expect(prisma.eventManager.create).toHaveBeenCalledWith({ data: { eventId: 42, userId: 7 } })
})

test("addEventManager rejects a soft-deleted (archived) organiser", async () => {
  asAdmin()
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 42 })
  // findFirst scoped to archivedAt:null returns null for an archived user.
  ;(prisma.user.findFirst as jest.Mock).mockResolvedValue(null)
  expect(await addEventManager(42, 7)).toEqual({ error: "User not found" })
  expect(prisma.eventManager.create).not.toHaveBeenCalled()
})

test("removeEventManager rejects non-editors", async () => {
  asOrganiser()
  expect(await removeEventManager(42, 7)).toEqual({ error: "Unauthorized" })
  expect(prisma.eventManager.deleteMany).not.toHaveBeenCalled()
})

test("removeEventManager deletes the link", async () => {
  asAdmin()
  expect(await removeEventManager(42, 7)).toBeUndefined()
  expect(prisma.eventManager.deleteMany).toHaveBeenCalledWith({ where: { eventId: 42, userId: 7 } })
})

test("setRegistrationClosed rejects a non-editor", async () => {
  asOrganiser()
  expect(await setRegistrationClosed(1, true)).toEqual({ error: "Unauthorized" })
  expect(prisma.event.update).not.toHaveBeenCalled()
})

test("setRegistrationClosed updates the flag for an editor", async () => {
  asAdmin()
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, slug: "camp" })
  const res = await setRegistrationClosed(1, true)
  expect(res).toBeUndefined()
  expect(prisma.event.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { registrationClosed: true } })
})
