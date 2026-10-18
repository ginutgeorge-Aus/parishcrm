/** @jest-environment node */
// One behaviour test per enforcement kind, against the real featureFlags
// module: only the stored `features` row is mocked.
jest.mock("server-only", () => ({}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  redirect: jest.fn(),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: jest.fn() },
    event: { update: jest.fn(), findUnique: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import EventsLayout from "@/app/(dashboard)/events/layout"
import { publishEvent } from "@/lib/actions/event"
import { FEATURE_OFF_MESSAGE } from "@/lib/features"

const findUnique = prisma.appSetting.findUnique as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  findUnique.mockResolvedValue({ key: "features", value: '{"events":false}' })
})

it("segment layout 404s while its feature is off", async () => {
  await expect(EventsLayout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND")
})

it("segment layout renders children while its feature is on", async () => {
  findUnique.mockResolvedValue(null)
  await expect(EventsLayout({ children: "page" })).resolves.toBe("page")
})

it("Server Action returns the off message before auth or DB work", async () => {
  expect(await publishEvent(1, true)).toEqual({ error: FEATURE_OFF_MESSAGE })
  expect(auth).not.toHaveBeenCalled()
  expect(prisma.event.update).not.toHaveBeenCalled()
})
