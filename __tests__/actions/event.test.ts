/** @jest-environment node */
import { createEvent, updateEvent, deleteEvent, publishEvent, resyncEventsToWebsite } from "@/lib/actions/event"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { resyncAllEvents, syncEventToWebsite, syncEventDeletion } from "@/lib/websiteSync"
import { logAudit } from "@/lib/audit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(), notFound: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/websiteSync", () => ({
  syncEventToWebsite: jest.fn(),
  syncEventDeletion: jest.fn(),
  resyncAllEvents: jest.fn(),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    event: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    ticketType: {
      findMany: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    registrationItem: { count: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn() },
    registration: { count: jest.fn().mockResolvedValue(0) },
    checkoutSession: { count: jest.fn().mockResolvedValue(0) },
    eventImage: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  }
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma))
  return { prisma }
})

const mockSession = (role: string) =>
  (auth as jest.Mock).mockResolvedValue({ user: { id: "999", role } })

beforeEach(() => {
  jest.clearAllMocks()
  // clearAllMocks() clears calls but NOT implementations, so a deleteEvent guard
  // test that sets a count to >0 would otherwise leak into every later
  // test that deletes an event. Re-assert the "nothing blocking" baseline.
  ;(prisma.registration.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.checkoutSession.count as jest.Mock).mockResolvedValue(0)
  // Re-establish the default interactive-transaction behaviour (run the callback
  // against the same mocks). A retry test overrides this to reject with
  // P2034; restoring it here stops that override leaking into later tests.
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => cb(prisma))
})

describe("createEvent", () => {
  it("returns error for VIEWER", async () => {
    mockSession("VIEWER")
    const fd = new FormData()
    const result = await createEvent(undefined, fd)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error when title missing", async () => {
    mockSession("PASTOR")
    const fd = new FormData()
    fd.set("date", "2026-08-15T18:00")
    const result = await createEvent(undefined, fd)
    expect(result?.error).toBeTruthy()
  })

  it("creates event and redirects for PASTOR", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "45")
    fd.set("ticketType.0.capacity", "")
    await createEvent(undefined, fd)
    expect(prisma.event.create).toHaveBeenCalled()
    expect(syncEventToWebsite).toHaveBeenCalledWith(1)
    expect(redirect).toHaveBeenCalledWith("/events/1/edit")
  })

  it("does not sync to the website when unauthorized", async () => {
    mockSession("VIEWER")
    await createEvent(undefined, new FormData())
    expect(syncEventToWebsite).not.toHaveBeenCalled()
  })

  it("revalidates the /events list so the new event isn't missing without a hard reload", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    await createEvent(undefined, fd)
    expect(revalidatePath).toHaveBeenCalledWith("/events")
  })
})

describe("createEvent — ticket price validation", () => {
  const ticketForm = (price: string) => {
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", price)
    fd.set("ticketType.0.capacity", "")
    return fd
  }

  it("passes a valid price to Prisma as an exact string, not a float", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    await createEvent(undefined, ticketForm("10.50"))
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketTypes: { create: [{ name: "Adult", price: "10.50", capacity: null, countsTowardWaiver: false }] },
      }),
    })
  })

  // a NAMED ticket with an invalid price must error, not be silently
  // dropped — a dropped row on update reads as a ticket-type removal.
  it("errors on a named ticket whose price has more than 2 decimal places instead of truncating", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const result = await createEvent(undefined, ticketForm("9.999"))
    expect(result).toEqual({ error: 'Invalid price for ticket type "Adult"' })
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("errors on a named ticket whose price is exponential notation (1e3) instead of accepting 1000", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const result = await createEvent(undefined, ticketForm("1e3"))
    expect(result).toEqual({ error: 'Invalid price for ticket type "Adult"' })
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  // TicketType.price is Decimal(10,2) — 8 integer digits max. A 9+ digit
  // price passes MONEY_DECIMAL_RE (no upper bound) and overflows the column,
  // surfacing as a raw Postgres numeric-overflow 500 instead of a clean error.
  it("errors on a price that overflows the Decimal(10,2) column instead of hitting a DB 500", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const result = await createEvent(undefined, ticketForm("100000000"))
    expect(result).toEqual({ error: 'Invalid price for ticket type "Adult"' })
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("accepts a price at the Decimal(10,2) max (99999999.99)", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    await createEvent(undefined, ticketForm("99999999.99"))
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketTypes: { create: [{ name: "Adult", price: "99999999.99", capacity: null, countsTowardWaiver: false }] },
      }),
    })
  })
})

describe("createEvent — ticket capacity bounds", () => {
  const capForm = (capacity: string) => {
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "45")
    fd.set("ticketType.0.capacity", capacity)
    return fd
  }

  it("rejects a capacity that overflows int4 instead of hitting a DB P2003", async () => {
    mockSession("PASTOR")
    const res = await createEvent(undefined, capForm("2147483648"))
    expect(res).toEqual({ error: expect.stringContaining("Capacity") })
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("rejects a zero/negative capacity", async () => {
    mockSession("PASTOR")
    const res = await createEvent(undefined, capForm("0"))
    expect(res).toEqual({ error: expect.stringContaining("Capacity") })
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("accepts a capacity at the int4 max", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    await createEvent(undefined, capForm("2147483647"))
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketTypes: { create: [{ name: "Adult", price: "45", capacity: 2147483647, countsTowardWaiver: false }] },
      }),
    })
  })
})

describe("createEvent — display-only & recurring", () => {
  beforeEach(() => (prisma.event.create as jest.Mock).mockClear())

  it("creates a display-only one-off event with no ticket types", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 7 })
    const fd = new FormData()
    fd.set("title", "Christmas Carols")
    fd.set("slug", "christmas-carols")
    fd.set("date", "2026-12-24T19:00")
    // no ticket types
    await createEvent(undefined, fd)
    expect(prisma.event.create).toHaveBeenCalled()
    const data = (prisma.event.create as jest.Mock).mock.calls[0][0].data
    expect(data.ticketTypes).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/events/7/edit")
  })

  it("creates a recurring event with no date, using recurs pattern", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 8 })
    const fd = new FormData()
    fd.set("title", "Sunday School")
    fd.set("slug", "sunday-school")
    fd.set("kind", "recurring")
    fd.set("recurs", "every-sunday")
    fd.set("recursLabel", "Every Sun")
    fd.set("startTime", "9:30 AM")
    fd.set("category", "education")
    await createEvent(undefined, fd)
    expect(prisma.event.create).toHaveBeenCalled()
    const data = (prisma.event.create as jest.Mock).mock.calls[0][0].data
    expect(data.kind).toBe("recurring")
    expect(data.recurs).toBe("every-sunday")
    expect(data.date).toBeNull()
    expect(data.category).toBe("education")
  })

  it("rejects a one-off event with no date", async () => {
    mockSession("PASTOR")
    const fd = new FormData()
    fd.set("title", "No Date Event")
    fd.set("slug", "no-date-event")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "10")
    fd.set("ticketType.0.capacity", "")
    const result = await createEvent(undefined, fd)
    expect(result?.error).toBeTruthy()
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("rejects a recurring event with no recurs pattern", async () => {
    mockSession("PASTOR")
    const fd = new FormData()
    fd.set("title", "Bad Recurring")
    fd.set("slug", "bad-recurring")
    fd.set("kind", "recurring")
    const result = await createEvent(undefined, fd)
    expect(result?.error).toBeTruthy()
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("coerces an invalid category to worship", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 9 })
    const fd = new FormData()
    fd.set("title", "Default Category")
    fd.set("slug", "default-category")
    fd.set("date", "2026-08-15T18:00")
    fd.set("category", "not-a-real-category")
    await createEvent(undefined, fd)
    const data = (prisma.event.create as jest.Mock).mock.calls[0][0].data
    expect(data.category).toBe("worship")
  })
})

describe("resyncEventsToWebsite", () => {
  it("returns error for PASTOR (admin only)", async () => {
    mockSession("PASTOR")
    const result = await resyncEventsToWebsite()
    expect(result).toEqual({ error: "Unauthorized" })
    expect(resyncAllEvents).not.toHaveBeenCalled()
  })

  it("resyncs all events for ADMIN and reports counts", async () => {
    mockSession("ADMIN")
    ;(resyncAllEvents as jest.Mock).mockResolvedValue({ synced: 5, failed: 0 })
    const result = await resyncEventsToWebsite()
    expect(resyncAllEvents).toHaveBeenCalled()
    expect(result).toHaveProperty("success")
  })

  it("includes the failed count in the message on partial failure", async () => {
    mockSession("ADMIN")
    ;(resyncAllEvents as jest.Mock).mockResolvedValue({ synced: 3, failed: 2 })
    const result = await resyncEventsToWebsite()
    expect(result).toEqual({ success: "Synced 3 events to website, 2 failed" })
  })
})

describe("deleteEvent", () => {
  it("returns error for PASTOR", async () => {
    mockSession("PASTOR")
    const result = await deleteEvent(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("deletes, pushes the deletion to the website, and redirects for ADMIN", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, slug: "summer-fair" })
    ;(prisma.event.delete as jest.Mock).mockResolvedValue({})
    await deleteEvent(1)
    expect(prisma.event.delete).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(syncEventDeletion).toHaveBeenCalledWith(1)
    expect(redirect).toHaveBeenCalledWith("/events")
  })

  it("revalidates the public event page so deleted-event content can't remain visible via stale cache", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, slug: "summer-fair" })
    ;(prisma.event.delete as jest.Mock).mockResolvedValue({})
    await deleteEvent(1)
    expect(revalidatePath).toHaveBeenCalledWith("/e/summer-fair")
  })

  it("returns an error instead of throwing when the delete fails", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.event.delete as jest.Mock).mockRejectedValue(new Error("FK violation"))
    const result = await deleteEvent(1)
    expect(result).toEqual({ error: "Could not delete this event. Please try again." })
    expect(syncEventDeletion).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("refuses to delete an event with non-CANCELLED registrations — never calls delete", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.registration.count as jest.Mock).mockResolvedValue(2)
    const result = await deleteEvent(1)
    expect(result).toEqual({
      error: "This event has registrations or a payment in progress — cancel them individually before deleting.",
    })
    expect(prisma.event.delete).not.toHaveBeenCalled()
    expect(prisma.registration.count).toHaveBeenCalledWith({
      where: { eventId: 1, paymentStatus: { not: "CANCELLED" } },
    })
  })

  it("refuses to delete while a CheckoutSession is OPEN (in-flight card payment) — never calls delete", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.checkoutSession.count as jest.Mock).mockResolvedValue(1)
    const result = await deleteEvent(1)
    expect(result).toEqual({
      error: "This event has registrations or a payment in progress — cancel them individually before deleting.",
    })
    expect(prisma.event.delete).not.toHaveBeenCalled()
    expect(prisma.checkoutSession.count).toHaveBeenCalledWith({ where: { eventId: 1, status: "OPEN" } })
  })
})

describe("updateEvent", () => {
  it("returns error for VIEWER", async () => {
    mockSession("VIEWER")
    const fd = new FormData()
    const result = await updateEvent(1, undefined, fd)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("updates event for PASTOR", async () => {
    mockSession("PASTOR")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const fd = new FormData()
    fd.set("title", "Updated Event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "updated-event")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "50")
    fd.set("ticketType.0.capacity", "")
    await updateEvent(1, undefined, fd)
    expect(prisma.event.updateMany).toHaveBeenCalled()
    expect(syncEventToWebsite).toHaveBeenCalledWith(1)
    // ?saved=1 drives the success flash on the edit page (redirect-to-self).
    expect(redirect).toHaveBeenCalledWith("/events/1/edit?saved=1")
  })
})

describe("updateEvent — optimistic concurrency", () => {
  const baseForm = () => {
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    return fd
  }

  beforeEach(() => {
    mockSession("PASTOR")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([])
  })

  it("returns a conflict error and does not sync when updatedAt is stale (0 rows matched)", async () => {
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    const fd = baseForm()
    fd.set("updatedAt", "2026-01-01T00:00:00.000Z")
    const result = await updateEvent(1, undefined, fd)
    expect(result?.error).toMatch(/changed by someone else/i)
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: 1, updatedAt: new Date("2026-01-01T00:00:00.000Z") },
      data: expect.any(Object),
    })
    expect(syncEventToWebsite).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("succeeds and still syncs to the website when updatedAt matches", async () => {
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const fd = baseForm()
    fd.set("updatedAt", "2026-01-01T00:00:00.000Z")
    await updateEvent(1, undefined, fd)
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: 1, updatedAt: new Date("2026-01-01T00:00:00.000Z") },
      data: expect.any(Object),
    })
    expect(syncEventToWebsite).toHaveBeenCalledWith(1)
    expect(redirect).toHaveBeenCalledWith("/events/1/edit?saved=1")
  })

  it("falls back to an unguarded update when no updatedAt is submitted", async () => {
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const fd = baseForm()
    await updateEvent(1, undefined, fd)
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.any(Object),
    })
    expect(redirect).toHaveBeenCalledWith("/events/1/edit?saved=1")
  })
})

describe("updateEvent — serialization retries", () => {
  const baseForm = () => {
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    return fd
  }

  beforeEach(() => {
    mockSession("PASTOR")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  })

  it("runs the edit in a Serializable transaction", async () => {
    await updateEvent(1, undefined, baseForm())
    const opts = (prisma.$transaction as jest.Mock).mock.calls[0][1]
    expect(opts).toEqual({ isolationLevel: "Serializable" })
  })

  it("retries the whole edit on a P2034 serialization conflict, then commits", async () => {
    const tx = prisma.$transaction as jest.Mock
    // First attempt loses the serialization race; the base impl (restored each
    // beforeEach) runs the callback normally on the retry.
    tx.mockRejectedValueOnce({ code: "P2034" })
    await updateEvent(1, undefined, baseForm())
    expect(tx).toHaveBeenCalledTimes(2)
    expect(redirect).toHaveBeenCalledWith("/events/1/edit?saved=1")
  })

  it("gives up with a friendly busy message after exhausting retries", async () => {
    const tx = prisma.$transaction as jest.Mock
    tx.mockRejectedValue({ code: "P2034" })
    const result = await updateEvent(1, undefined, baseForm())
    expect(result?.error).toMatch(/registering for this event right now/i)
    expect(tx).toHaveBeenCalledTimes(3)
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe("updateEvent — ticket type diffing", () => {
  const baseForm = () => {
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    return fd
  }

  beforeEach(() => {
    mockSession("PASTOR")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  })

  it("updates an existing ticket type in place (keeps its id)", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5, capacity: 100 }])
    const fd = baseForm()
    fd.set("ticketType.0.id", "5")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "50")
    fd.set("ticketType.0.capacity", "100")
    await updateEvent(1, undefined, fd)
    expect(prisma.ticketType.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { name: "Adult", price: "50", capacity: 100, countsTowardWaiver: false },
    })
    expect(prisma.ticketType.deleteMany).not.toHaveBeenCalled()
    expect(prisma.ticketType.createMany).not.toHaveBeenCalled()
  })

  it("creates a new ticket type when the row has no id", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5 }])
    const fd = baseForm()
    fd.set("ticketType.0.id", "5")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "50")
    fd.set("ticketType.0.capacity", "")
    fd.set("ticketType.1.id", "")
    fd.set("ticketType.1.name", "Child")
    fd.set("ticketType.1.price", "20")
    fd.set("ticketType.1.capacity", "")
    await updateEvent(1, undefined, fd)
    expect(prisma.ticketType.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 1, name: "Child", price: "20", capacity: null, countsTowardWaiver: false }],
    })
    expect(prisma.ticketType.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes a removed ticket type when nothing references it", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5 }, { id: 6 }])
    ;(prisma.registrationItem.count as jest.Mock).mockResolvedValue(0)
    const fd = baseForm()
    fd.set("ticketType.0.id", "5")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "50")
    fd.set("ticketType.0.capacity", "")
    await updateEvent(1, undefined, fd)
    expect(prisma.registrationItem.count).toHaveBeenCalledWith({
      where: { ticketTypeId: { in: [6] } },
    })
    expect(prisma.ticketType.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [6] } },
    })
    // Kept row 5 must still be updated in the same call.
    expect(prisma.ticketType.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { name: "Adult", price: "50", capacity: null, countsTowardWaiver: false },
    })
  })

  it("handles update + create + delete together in one call", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([
      { id: 5, capacity: null },
      { id: 6, capacity: 20 },
      { id: 7, capacity: null },
    ])
    ;(prisma.registrationItem.count as jest.Mock).mockResolvedValue(0)
    const fd = baseForm()
    fd.set("ticketType.0.id", "5")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "50")
    fd.set("ticketType.0.capacity", "")
    fd.set("ticketType.1.id", "6")
    fd.set("ticketType.1.name", "Concession")
    fd.set("ticketType.1.price", "35")
    fd.set("ticketType.1.capacity", "20")
    fd.set("ticketType.2.id", "")
    fd.set("ticketType.2.name", "Child")
    fd.set("ticketType.2.price", "10")
    fd.set("ticketType.2.capacity", "")
    await updateEvent(1, undefined, fd)
    expect(prisma.ticketType.update).toHaveBeenCalledTimes(2)
    expect(prisma.ticketType.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { name: "Adult", price: "50", capacity: null, countsTowardWaiver: false },
    })
    expect(prisma.ticketType.update).toHaveBeenCalledWith({
      where: { id: 6 },
      data: { name: "Concession", price: "35", capacity: 20, countsTowardWaiver: false },
    })
    expect(prisma.ticketType.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 1, name: "Child", price: "10", capacity: null, countsTowardWaiver: false }],
    })
    expect(prisma.ticketType.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
    })
  })

  it("blocks removal of a ticket type that has registrations", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([
      { id: 5, capacity: null },
      { id: 6, capacity: null },
    ])
    ;(prisma.registrationItem.count as jest.Mock).mockResolvedValue(2)
    const fd = baseForm()
    fd.set("ticketType.0.id", "5")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "50")
    fd.set("ticketType.0.capacity", "")
    const result = await updateEvent(1, undefined, fd)
    expect(result?.error).toMatch(/registration/i)
    expect(prisma.ticketType.deleteMany).not.toHaveBeenCalled()
    expect(prisma.event.updateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("treats an id that doesn't belong to this event as a new row (IDOR guard)", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([])
    const fd = baseForm()
    fd.set("ticketType.0.id", "999")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "50")
    fd.set("ticketType.0.capacity", "")
    await updateEvent(1, undefined, fd)
    expect(prisma.ticketType.update).not.toHaveBeenCalled()
    expect(prisma.ticketType.deleteMany).not.toHaveBeenCalled()
    expect(prisma.ticketType.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 1, name: "Adult", price: "50", capacity: null, countsTowardWaiver: false }],
    })
  })

  it("returns a friendly error when the FK restrict still fires (race backstop)", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 6 }])
    ;(prisma.registrationItem.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.ticketType.deleteMany as jest.Mock).mockRejectedValue(
      new Error("Foreign key constraint violated on the constraint: `RegistrationItem_ticketTypeId_fkey`")
    )
    // No ticketType fields submitted → existing id 6 counts as removed,
    // pre-check sees 0 refs, deleteMany fires and hits the (mocked) FK race.
    const fd = baseForm()
    const result = await updateEvent(1, undefined, fd)
    expect(result?.error).toMatch(/registration/i)
  })
})

describe("createEvent — stray ticket type id ignored", () => {
  it("never passes an id through to ticketTypes.create", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    fd.set("ticketType.0.id", "42")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "45")
    fd.set("ticketType.0.capacity", "")
    await createEvent(undefined, fd)
    const data = (prisma.event.create as jest.Mock).mock.calls[0][0].data
    expect(data.ticketTypes.create).toEqual([{ name: "Adult", price: "45", capacity: null, countsTowardWaiver: false }])
  })
})

describe("createEvent title max length", () => {
  it("rejects title over 200 chars", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockClear()
    const fd = new FormData()
    fd.set("title", "A".repeat(201))
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    const result = await createEvent(undefined, fd)
    expect(result?.error).toBeTruthy()
    expect(prisma.event.create).not.toHaveBeenCalled()
  })
})

describe("publishEvent", () => {
  it("returns error for VIEWER", async () => {
    mockSession("VIEWER")
    const result = await publishEvent(1, true)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("updates isPublished, syncs to the website, and revalidates", async () => {
    mockSession("PASTOR")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, slug: "summer-fair" })
    ;(prisma.event.update as jest.Mock).mockResolvedValue({})
    await publishEvent(1, true)
    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isPublished: true },
    })
    expect(syncEventToWebsite).toHaveBeenCalledWith(1)
    expect(revalidatePath).toHaveBeenCalledWith("/events/1/edit")
    expect(revalidatePath).toHaveBeenCalledWith("/events")
  })

  it("revalidates the public event page so a stale publish/unpublish state doesn't survive the cache", async () => {
    mockSession("PASTOR")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, slug: "summer-fair" })
    ;(prisma.event.update as jest.Mock).mockResolvedValue({})
    await publishEvent(1, false)
    expect(revalidatePath).toHaveBeenCalledWith("/e/summer-fair")
  })
})

describe("event audit logging", () => {
  const mockLogAudit = logAudit as jest.Mock
  const adminSession = () =>
    (auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "9" } })

  const baseForm = () => {
    const fd = new FormData()
    fd.set("title", "Parish Picnic")
    fd.set("slug", "parish-picnic")
    fd.set("date", "2026-08-15T10:00")
    return fd
  }

  it("audit-logs EVENT_CREATED", async () => {
    adminSession()
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 4 })
    await createEvent(undefined, baseForm())
    expect(mockLogAudit).toHaveBeenCalledWith(9, "EVENT_CREATED", "Event", 4, { slug: "parish-picnic" })
  })

  it("audit-logs EVENT_UPDATED with removedTicketTypeIds", async () => {
    adminSession()
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5 }, { id: 6 }])
    ;(prisma.registrationItem.count as jest.Mock).mockResolvedValue(0)
    // reset the FK-race rejection a previous test left on deleteMany
    ;(prisma.ticketType.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const fd = baseForm()
    // keep ticket type 5, drop 6
    fd.set("ticketType.0.id", "5")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "10")
    fd.set("ticketType.0.capacity", "")
    const result = await updateEvent(1, undefined, fd)
    expect(result).toBeUndefined()
    expect(mockLogAudit).toHaveBeenCalledWith(9, "EVENT_UPDATED", "Event", 1, {
      slug: "parish-picnic",
      removedTicketTypeIds: [6],
    })
  })

  it("audit-logs EVENT_DELETED", async () => {
    adminSession()
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 2 })
    ;(prisma.event.delete as jest.Mock).mockResolvedValue({})
    await deleteEvent(2)
    expect(mockLogAudit).toHaveBeenCalledWith(9, "EVENT_DELETED", "Event", 2)
  })

  it("audit-logs EVENT_PUBLISHED with publish state", async () => {
    adminSession()
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 3 })
    ;(prisma.event.update as jest.Mock).mockResolvedValue({})
    await publishEvent(3, true)
    expect(mockLogAudit).toHaveBeenCalledWith(9, "EVENT_PUBLISHED", "Event", 3, { published: true })
  })

  it("audit-logs EVENT_PUBLISHED with published=false on unpublish", async () => {
    adminSession()
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 3 })
    ;(prisma.event.update as jest.Mock).mockResolvedValue({})
    await publishEvent(3, false)
    expect(mockLogAudit).toHaveBeenCalledWith(9, "EVENT_PUBLISHED", "Event", 3, { published: false })
  })
})

describe("event existence checks", () => {
  const baseForm = () => {
    const fd = new FormData()
    fd.set("title", "Ghost Event")
    fd.set("slug", "ghost-event")
    fd.set("date", "2026-08-15T18:00")
    return fd
  }

  beforeEach(() => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
  })

  it("updateEvent returns 'Event not found' for a non-existent id", async () => {
    mockSession("PASTOR")
    const result = await updateEvent(999, undefined, baseForm())
    expect(result).toEqual({ error: "Event not found" })
    expect(prisma.event.updateMany).not.toHaveBeenCalled()
    expect(syncEventToWebsite).not.toHaveBeenCalled()
  })

  it("publishEvent returns 'Event not found' for a non-existent id", async () => {
    mockSession("PASTOR")
    const result = await publishEvent(999, true)
    expect(result).toEqual({ error: "Event not found" })
    expect(prisma.event.update).not.toHaveBeenCalled()
    expect(syncEventToWebsite).not.toHaveBeenCalled()
  })

  it("deleteEvent returns 'Event not found' and never calls syncEventDeletion", async () => {
    mockSession("ADMIN")
    const result = await deleteEvent(999)
    expect(result).toEqual({ error: "Event not found" })
    expect(prisma.event.delete).not.toHaveBeenCalled()
    expect(syncEventDeletion).not.toHaveBeenCalled()
  })
})

describe("parse caps", () => {
  const baseForm = () => {
    const fd = new FormData()
    fd.set("title", "Big Form")
    fd.set("slug", "big-form")
    fd.set("date", "2026-08-15T18:00")
    return fd
  }

  beforeEach(() => mockSession("PASTOR"))

  it("rejects more than 20 ticket types", async () => {
    const fd = baseForm()
    for (let i = 0; i <= 20; i++) {
      fd.set(`ticketType.${i}.name`, `Type ${i}`)
      fd.set(`ticketType.${i}.price`, "10")
      fd.set(`ticketType.${i}.capacity`, "")
    }
    const result = await createEvent(undefined, fd)
    expect(result?.error).toMatch(/too many ticket types/i)
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("accepts exactly 20 ticket types", async () => {
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const fd = baseForm()
    for (let i = 0; i < 20; i++) {
      fd.set(`ticketType.${i}.name`, `Type ${i}`)
      fd.set(`ticketType.${i}.price`, "10")
      fd.set(`ticketType.${i}.capacity`, "")
    }
    await createEvent(undefined, fd)
    expect(prisma.event.create).toHaveBeenCalled()
  })

  it("rejects more than 20 custom questions", async () => {
    const fd = baseForm()
    for (let i = 0; i <= 20; i++) {
      fd.set(`customQuestion.${i}.label`, `Question ${i}`)
      fd.set(`customQuestion.${i}.type`, "text")
    }
    const result = await createEvent(undefined, fd)
    expect(result?.error).toMatch(/too many questions/i)
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("rejects oversized updateEvent forms too (shared helpers)", async () => {
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    const fd = baseForm()
    for (let i = 0; i <= 20; i++) {
      fd.set(`ticketType.${i}.name`, `Type ${i}`)
      fd.set(`ticketType.${i}.price`, "10")
      fd.set(`ticketType.${i}.capacity`, "")
    }
    const result = await updateEvent(1, undefined, fd)
    expect(result?.error).toMatch(/too many ticket types/i)
    expect(prisma.event.updateMany).not.toHaveBeenCalled()
  })
})

describe("updateEvent — capacity below sold count", () => {
  const baseForm = () => {
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("slug", "harvest-dinner-2026")
    fd.set("date", "2026-08-15T18:00")
    fd.set("ticketType.0.id", "5")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "50")
    return fd
  }

  beforeEach(() => {
    mockSession("PASTOR")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  })

  it("blocks lowering a kept ticket type's capacity below its sold count", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5, capacity: 100 }])
    ;(prisma.registrationItem.groupBy as jest.Mock).mockResolvedValue([{ ticketTypeId: 5, _sum: { quantity: 30 } }])
    const fd = baseForm()
    fd.set("ticketType.0.capacity", "20")
    const result = await updateEvent(1, undefined, fd)
    expect(result?.error).toMatch(/already sold/i)
    expect(prisma.event.updateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("blocks setting a capacity below sold on a previously unlimited type", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5, capacity: null }])
    ;(prisma.registrationItem.groupBy as jest.Mock).mockResolvedValue([{ ticketTypeId: 5, _sum: { quantity: 30 } }])
    const fd = baseForm()
    fd.set("ticketType.0.capacity", "20")
    const result = await updateEvent(1, undefined, fd)
    expect(result?.error).toMatch(/already sold/i)
    expect(prisma.event.updateMany).not.toHaveBeenCalled()
  })

  it("keeps the full ticket name in the error when the name contains a colon", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5, capacity: 100 }])
    ;(prisma.registrationItem.groupBy as jest.Mock).mockResolvedValue([{ ticketTypeId: 5, _sum: { quantity: 30 } }])
    const fd = baseForm()
    fd.set("ticketType.0.name", "VIP: Front Row")
    fd.set("ticketType.0.capacity", "20")
    const result = await updateEvent(1, undefined, fd)
    expect(result?.error).toBe("Cannot set VIP: Front Row capacity below 30 already sold")
  })

  it("allows lowering capacity to exactly the sold count", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5, capacity: 100 }])
    ;(prisma.registrationItem.groupBy as jest.Mock).mockResolvedValue([{ ticketTypeId: 5, _sum: { quantity: 30 } }])
    const fd = baseForm()
    fd.set("ticketType.0.capacity", "30")
    await updateEvent(1, undefined, fd)
    expect(prisma.event.updateMany).toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/events/1/edit?saved=1")
  })

  it("excludes CANCELLED registrations from the sold count", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5, capacity: 100 }])
    ;(prisma.registrationItem.groupBy as jest.Mock).mockResolvedValue([{ ticketTypeId: 5, _sum: { quantity: 10 } }])
    const fd = baseForm()
    fd.set("ticketType.0.capacity", "20")
    await updateEvent(1, undefined, fd)
    // The sold count must not include cancelled tickets, or a valid reduction is blocked.
    expect(prisma.registrationItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          registration: { paymentStatus: { not: "CANCELLED" } },
        }),
      })
    )
  })

  it("does not query sold counts when capacity is not lowered", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([{ id: 5, capacity: 100 }])
    const fd = baseForm()
    fd.set("ticketType.0.capacity", "100")
    await updateEvent(1, undefined, fd)
    expect(prisma.registrationItem.groupBy).not.toHaveBeenCalled()
    expect(prisma.event.updateMany).toHaveBeenCalled()
  })

  it("checks multiple tightened ticket types in a single groupBy query", async () => {
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([
      { id: 5, capacity: 100 },
      { id: 6, capacity: 50 },
    ])
    ;(prisma.registrationItem.groupBy as jest.Mock).mockResolvedValue([
      { ticketTypeId: 5, _sum: { quantity: 30 } },
      { ticketTypeId: 6, _sum: { quantity: 10 } },
    ])
    const fd = baseForm()
    fd.set("ticketType.0.capacity", "40")
    fd.set("ticketType.1.id", "6")
    fd.set("ticketType.1.name", "Child")
    fd.set("ticketType.1.price", "0")
    fd.set("ticketType.1.capacity", "5")
    const result = await updateEvent(1, undefined, fd)
    expect(prisma.registrationItem.groupBy).toHaveBeenCalledTimes(1)
    expect(prisma.registrationItem.groupBy).toHaveBeenCalledWith({
      by: ["ticketTypeId"],
      where: {
        ticketTypeId: { in: [5, 6] },
        registration: { paymentStatus: { not: "CANCELLED" } },
      },
      _sum: { quantity: true },
    })
    expect(result?.error).toMatch(/already sold/i) // Child: capacity 5 < sold 10
  })
})

describe("parseTicketTypes — missing capacity field", () => {
  // A named ticket row whose `capacity` field is absent entirely (partial or
  // programmatic POST) must be treated as blank/unlimited, not crash on
  // `null.trim()`.
  it("treats a named ticket row with no capacity field as unlimited instead of throwing", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const fd = new FormData()
    fd.set("title", "Harvest Dinner")
    fd.set("date", "2026-08-15T18:00")
    fd.set("slug", "harvest-dinner-2026")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "45")
    // NOTE: no ticketType.0.capacity field set at all
    const result = await createEvent(undefined, fd)
    expect(result).toBeUndefined()
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketTypes: { create: [{ name: "Adult", price: "45", capacity: null, countsTowardWaiver: false }] },
      }),
    })
  })
})

describe("createEvent slug bound", () => {
  it("rejects an over-long slug", async () => {
    mockSession("ADMIN")
    const fd = new FormData()
    fd.set("title", "Test Event")
    fd.set("slug", "a".repeat(201))
    const result = await createEvent(undefined, fd)
    expect(result?.error).toMatch(/too long/i)
    expect(prisma.event.create).not.toHaveBeenCalled()
  })
})

describe("createEvent — imageUrl validation", () => {
  it("rejects a non-https image URL", async () => {
    mockSession("PASTOR")
    const fd = new FormData()
    fd.set("title", "Test Event")
    fd.set("slug", "test-event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("imageUrl", "http://example.com/x.jpg")
    const result = await createEvent(undefined, fd)
    expect(result).toEqual({ error: "Image URL must start with https://" })
  })

  it("persists a valid https image URL on create", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const fd = new FormData()
    fd.set("title", "Test Event")
    fd.set("slug", "test-event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("imageUrl", "https://cdn.example.com/hero.jpg")
    await createEvent(undefined, fd)
    expect(prisma.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imageUrl: "https://cdn.example.com/hero.jpg" }),
      })
    )
  })
})

describe("parseCustomQuestions — ticketTypeNames", () => {
  beforeEach(() => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
  })

  it("stores ticketTypeNames on a custom question when provided", async () => {
    const fd = new FormData()
    fd.set("title", "Test Event")
    fd.set("slug", "test-event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("customQuestion.0.label", "Child age")
    fd.set("customQuestion.0.type", "number")
    fd.set("customQuestion.0.required", "true")
    fd.set("customQuestion.0.ticketTypeNames", "Child, Student")
    await createEvent(undefined, fd)
    const arg = (prisma.event.create as jest.Mock).mock.calls[0][0]
    expect(arg.data.customQuestions).toEqual([
      expect.objectContaining({ id: expect.any(String), label: "Child age", type: "number", required: true, ticketTypeNames: ["Child", "Student"] }),
    ])
  })

  it("parses a JSON-encoded ticketTypeNames list, keeping comma names whole", async () => {
    const fd = new FormData()
    fd.set("title", "Test Event")
    fd.set("slug", "test-event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("customQuestion.0.label", "Child age")
    fd.set("customQuestion.0.type", "number")
    fd.set("customQuestion.0.required", "true")
    fd.set("customQuestion.0.ticketTypeNames", JSON.stringify(["Adult, member", "Child"]))
    await createEvent(undefined, fd)
    const arg = (prisma.event.create as jest.Mock).mock.calls[0][0]
    expect(arg.data.customQuestions).toEqual([
      expect.objectContaining({ id: expect.any(String), label: "Child age", type: "number", required: true, ticketTypeNames: ["Adult, member", "Child"] }),
    ])
  })

  it("falls back to the legacy comma list for a bracket-prefixed name like [VIP]", async () => {
    const fd = new FormData()
    fd.set("title", "Test Event")
    fd.set("slug", "test-event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("customQuestion.0.label", "Child age")
    fd.set("customQuestion.0.type", "number")
    fd.set("customQuestion.0.required", "true")
    fd.set("customQuestion.0.ticketTypeNames", "[VIP], Child")
    await createEvent(undefined, fd)
    const arg = (prisma.event.create as jest.Mock).mock.calls[0][0]
    expect(arg.data.customQuestions).toEqual([
      expect.objectContaining({ id: expect.any(String), label: "Child age", type: "number", required: true, ticketTypeNames: ["[VIP]", "Child"] }),
    ])
  })

  it("omits ticketTypeNames when the field is blank", async () => {
    const fd = new FormData()
    fd.set("title", "Test Event")
    fd.set("slug", "test-event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("customQuestion.0.label", "Dietary")
    fd.set("customQuestion.0.type", "text")
    await createEvent(undefined, fd)
    const arg = (prisma.event.create as jest.Mock).mock.calls[0][0]
    expect(arg.data.customQuestions[0]).not.toHaveProperty("ticketTypeNames")
  })
})

describe("parseCustomQuestions — new types + consent body", () => {
  it("parses radio/checkbox/consent types and consent body", async () => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
    const fd = new FormData()
    fd.set("title", "Community Event")
    fd.set("slug", "community-event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("customQuestion.0.label", "Meal")
    fd.set("customQuestion.0.type", "checkbox")
    fd.set("customQuestion.0.options", "Veg, Non-veg")
    fd.set("customQuestion.1.label", "Waiver")
    fd.set("customQuestion.1.type", "consent")
    fd.set("customQuestion.1.body", "I accept the terms.")
    fd.set("customQuestion.1.required", "true")
    await createEvent(undefined, fd)
    const arg = (prisma.event.create as jest.Mock).mock.calls[0][0].data.customQuestions
    expect(arg).toEqual([
      { id: expect.any(String), label: "Meal", type: "checkbox", required: false, options: ["Veg", "Non-veg"] },
      { id: expect.any(String), label: "Waiver", type: "consent", required: true, body: "I accept the terms." },
    ])
    // Each question gets its own distinct id — not derived from position.
    expect(arg[0].id).not.toBe(arg[1].id)
  })
})

describe("createEvent image upload", () => {
  const baseForm = () => {
    const fd = new FormData()
    fd.set("title", "Gala"); fd.set("slug", "gala"); fd.set("kind", "one_off")
    fd.set("date", "2026-08-15T18:00")
    return fd
  }

  it("rejects a non-image poster file", async () => {
    mockSession("ADMIN")
    const fd = baseForm()
    fd.set("posterFile", new File(["x"], "p.txt", { type: "text/plain" }))
    const result = await createEvent(undefined, fd)
    expect(result?.error).toMatch(/JPEG, PNG or WebP/)
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("rejects an oversized poster file", async () => {
    mockSession("ADMIN")
    const fd = baseForm()
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "p.png", { type: "image/png" })
    fd.set("posterFile", big)
    const result = await createEvent(undefined, fd)
    expect(result?.error).toMatch(/2 MB/)
  })

  it("upserts a valid poster after creating the event", async () => {
    mockSession("ADMIN")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 42 })
    const fd = baseForm()
    fd.set("posterFile", new File(["PNG"], "p.png", { type: "image/png" }))
    await createEvent(undefined, fd)
    expect(prisma.eventImage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_kind: { eventId: 42, kind: "POSTER" } },
      }),
    )
  })

  it("skips images when no file is provided", async () => {
    mockSession("ADMIN")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 43 })
    await createEvent(undefined, baseForm())
    expect(prisma.eventImage.upsert).not.toHaveBeenCalled()
  })

  it("deletes the banner image when banner.remove is set", async () => {
    mockSession("ADMIN")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 44 })
    const fd = baseForm()
    fd.set("banner.remove", "true")
    await createEvent(undefined, fd)
    expect(prisma.eventImage.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 44, kind: "BANNER" },
    })
    expect(prisma.eventImage.upsert).not.toHaveBeenCalled()
  })

  it("prefers a new file over remove when both are set in one submit", async () => {
    mockSession("ADMIN")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 45 })
    const fd = baseForm()
    fd.set("banner.remove", "true")
    fd.set("bannerFile", new File(["PNG"], "b.png", { type: "image/png" }))
    await createEvent(undefined, fd)
    expect(prisma.eventImage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_kind: { eventId: 45, kind: "BANNER" } },
      }),
    )
    expect(prisma.eventImage.deleteMany).not.toHaveBeenCalled()
  })
})

describe("updateEvent image upload", () => {
  const baseForm = () => {
    const fd = new FormData()
    fd.set("title", "Gala"); fd.set("slug", "gala"); fd.set("kind", "one_off")
    fd.set("date", "2026-08-15T18:00")
    return fd
  }

  beforeEach(() => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.ticketType.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  })

  it("upserts a valid poster inside the transaction on update", async () => {
    const fd = baseForm()
    fd.set("posterFile", new File(["PNG"], "p.png", { type: "image/png" }))
    await updateEvent(1, undefined, fd)
    expect(prisma.eventImage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_kind: { eventId: 1, kind: "POSTER" } },
      }),
    )
  })

  it("does NOT upsert the image when the event is stale (updateMany count 0)", async () => {
    ;(prisma.event.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    const fd = baseForm()
    fd.set("posterFile", new File(["PNG"], "p.png", { type: "image/png" }))
    const result = await updateEvent(1, undefined, fd)
    expect(result?.error).toMatch(/changed by someone else/i)
    expect(prisma.eventImage.upsert).not.toHaveBeenCalled()
  })
})

describe("parseCustomQuestions — per-question scope", () => {
  beforeEach(() => {
    mockSession("PASTOR")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 1 })
  })

  it("parses per-question scope (defaults to order)", async () => {
    const fd = new FormData()
    fd.set("title", "Test Event")
    fd.set("slug", "test-event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("customQuestion.0.label", "Diet")
    fd.set("customQuestion.0.type", "text")
    fd.set("customQuestion.0.scope", "attendee")
    fd.set("customQuestion.1.label", "Notes")
    fd.set("customQuestion.1.type", "text")
    await createEvent(undefined, fd)
    const qs = (prisma.event.create as jest.Mock).mock.calls[0][0].data.customQuestions
    expect(qs[0].scope).toBe("attendee")
    expect(qs[1]).not.toHaveProperty("scope")
  })

  it("ignores invalid scope values (treats as order)", async () => {
    const fd = new FormData()
    fd.set("title", "Test Event")
    fd.set("slug", "test-event")
    fd.set("date", "2026-08-15T18:00")
    fd.set("customQuestion.0.label", "Diet")
    fd.set("customQuestion.0.type", "text")
    fd.set("customQuestion.0.scope", "bogus")
    await createEvent(undefined, fd)
    const qs = (prisma.event.create as jest.Mock).mock.calls[0][0].data.customQuestions
    expect(qs[0]).not.toHaveProperty("scope")
  })
})

describe("createEvent — family waiver fields", () => {
  it("persists waiver settings and per-ticket countsTowardWaiver", async () => {
    mockSession("ADMIN")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 7 })
    const fd = new FormData()
    fd.set("title", "Fete")
    fd.set("date", "2026-09-01T10:00")
    fd.set("slug", "fete-2026")
    fd.set("familyWaiverEnabled", "on")
    fd.set("familyWaiverThreshold", "4")
    fd.set("ticketType.0.name", "Member")
    fd.set("ticketType.0.price", "10")
    fd.set("ticketType.0.capacity", "")
    fd.set("ticketType.0.countsToward", "on")
    fd.set("ticketType.1.name", "Visitor")
    fd.set("ticketType.1.price", "25")
    fd.set("ticketType.1.capacity", "")
    // countsToward omitted → unchecked → false
    await createEvent(undefined, fd)

    const arg = (prisma.event.create as jest.Mock).mock.calls[0][0]
    expect(arg.data.familyWaiverEnabled).toBe(true)
    expect(arg.data.familyWaiverThreshold).toBe(4)
    expect(arg.data.ticketTypes.create).toEqual([
      { name: "Member", price: "10", capacity: null, countsTowardWaiver: true },
      { name: "Visitor", price: "25", capacity: null, countsTowardWaiver: false },
    ])
  })

  it("defaults threshold to 4 and waiver off when fields absent", async () => {
    mockSession("ADMIN")
    ;(prisma.event.create as jest.Mock).mockResolvedValue({ id: 8 })
    const fd = new FormData()
    fd.set("title", "Plain")
    fd.set("date", "2026-09-01T10:00")
    fd.set("slug", "plain-2026")
    fd.set("ticketType.0.name", "Adult")
    fd.set("ticketType.0.price", "5")
    fd.set("ticketType.0.capacity", "")
    fd.set("ticketType.0.countsToward", "on")
    await createEvent(undefined, fd)

    const arg = (prisma.event.create as jest.Mock).mock.calls[0][0]
    expect(arg.data.familyWaiverEnabled).toBe(false)
    expect(arg.data.familyWaiverThreshold).toBe(4)
  })
})
