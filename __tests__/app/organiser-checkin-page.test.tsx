/** @jest-environment node */
import Page from "@/app/(organiser)/my-events/[id]/check-in/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageEvent } from "@/lib/eventManager"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOTFOUND") }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { event: { findUnique: jest.fn() } } }))
jest.mock("@/lib/eventManager", () => ({ canManageEvent: jest.fn() }))
jest.mock("@/components/events/CheckInList", () => ({ CheckInList: () => null }))

const mockEvent = {
  id: 1,
  title: "Church Camp",
  registrations: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(canManageEvent as jest.Mock).mockResolvedValue(true)
})

it("redirects an unauthenticated user", async () => {
  ;(auth as jest.Mock).mockResolvedValue(null)
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("REDIRECT")
})

// an EVENT_ORGANISER not assigned to this event must not reach it —
// an unassigned event is indistinguishable from a missing one.
it("notFound when the organiser doesn't manage this event (IDOR)", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(canManageEvent as jest.Mock).mockResolvedValue(false)
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("NOTFOUND")
  expect(prisma.event.findUnique).not.toHaveBeenCalled()
})

it("renders for an assigned organiser", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
  const ui = await Page({ params: Promise.resolve({ id: "1" }) })
  expect(ui).toBeTruthy()
})

it("notFound when event missing", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("NOTFOUND")
})

it("notFound for a non-numeric id", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  await expect(Page({ params: Promise.resolve({ id: "abc" }) })).rejects.toThrow("NOTFOUND")
  expect(prisma.event.findUnique).not.toHaveBeenCalled()
})

it("flattens registrations into per-attendee rows, excluding CANCELLED", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
    ...mockEvent,
    registrations: [
      {
        publicToken: "tok1",
        firstName: "Ann",
        lastName: "Lee",
        items: [
          {
            ticketType: { name: "Adult" },
            attendees: [{ id: 10, name: "Ann Lee", checkedInAt: null }],
          },
        ],
      },
    ],
  })
  await Page({ params: Promise.resolve({ id: "1" }) })
  // Query excludes CANCELLED registrations — the same shape as the admin twin.
  const call = (prisma.event.findUnique as jest.Mock).mock.calls[0][0]
  expect(call.select.registrations.where).toEqual({ paymentStatus: { not: "CANCELLED" } })
})
