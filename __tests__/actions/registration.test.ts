/** @jest-environment node */
import { markPaid, cancelRegistration, toggleAttendeeCheckIn, resetEventRegistrations } from "@/lib/actions/registration"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { logAudit } from "@/lib/audit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    registration: {
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    attendee: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    eventManager: { findUnique: jest.fn() },
    event: { findUnique: jest.fn() },
    waitlist: { deleteMany: jest.fn() },
    checkoutSession: { deleteMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  },
}))

const mockSession = (role: string) =>
  (auth as jest.Mock).mockResolvedValue({ user: { role, id: "1" } })

beforeEach(() => { jest.clearAllMocks() })

describe("markPaid", () => {
  it("returns error for VIEWER", async () => {
    mockSession("VIEWER")
    const result = await markPaid(1, 1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("transitions PENDING → PAID with a status-guarded updateMany", async () => {
    mockSession("PASTOR")
    ;(prisma.registration.findUnique as jest.Mock).mockResolvedValue({ eventId: 1, paymentStatus: "PENDING" })
    ;(prisma.registration.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await markPaid(1, 1)
    expect(prisma.registration.updateMany).toHaveBeenCalledWith({
      where: { id: 1, eventId: 1, paymentStatus: "PENDING" },
      data: { paymentStatus: "PAID" },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "REGISTRATION_PAID", "Registration", 1, { eventId: 1 })
    expect(revalidatePath).toHaveBeenCalledWith("/events/1/registrations")
  })

  it("does not overwrite a registration cancelled after the status read ( race)", async () => {
    mockSession("ADMIN")
    // Read sees PENDING, but a concurrent cancel lands before the write, so the
    // guarded updateMany matches 0 rows and the re-read now shows CANCELLED.
    ;(prisma.registration.findUnique as jest.Mock)
      .mockResolvedValueOnce({ eventId: 1, paymentStatus: "PENDING" })
      .mockResolvedValueOnce({ paymentStatus: "CANCELLED" })
    ;(prisma.registration.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    const result = await markPaid(1, 1)
    expect(result).toEqual({ error: "Cannot mark a cancelled registration as paid" })
    expect(logAudit).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("returns error when registration belongs to a different event (IDOR guard)", async () => {
    mockSession("ADMIN")
    ;(prisma.registration.findUnique as jest.Mock).mockResolvedValue({ eventId: 99 })
    const result = await markPaid(1, 1)
    expect(result).toEqual({ error: "Registration not found" })
    expect(prisma.registration.update).not.toHaveBeenCalled()
  })

  it("is a no-op when already PAID (idempotent — no re-write, no duplicate audit)", async () => {
    mockSession("ADMIN")
    ;(prisma.registration.findUnique as jest.Mock).mockResolvedValue({ eventId: 1, paymentStatus: "PAID" })
    const result = await markPaid(1, 1)
    expect(result).toBeUndefined()
    expect(prisma.registration.update).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("blocks marking a CANCELLED registration as PAID (state-machine guard)", async () => {
    mockSession("ADMIN")
    ;(prisma.registration.findUnique as jest.Mock).mockResolvedValue({ eventId: 1, paymentStatus: "CANCELLED" })
    const result = await markPaid(1, 1)
    expect(result).toEqual({ error: "Cannot mark a cancelled registration as paid" })
    expect(prisma.registration.update).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })
})

describe("cancelRegistration", () => {
  it("returns error for VIEWER", async () => {
    mockSession("VIEWER")
    const result = await cancelRegistration(1, 1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("updates paymentStatus to CANCELLED", async () => {
    mockSession("PASTOR")
    ;(prisma.registration.findUnique as jest.Mock).mockResolvedValue({ eventId: 1, paymentStatus: "PENDING" })
    ;(prisma.registration.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await cancelRegistration(1, 1)
    expect(prisma.registration.updateMany).toHaveBeenCalledWith({
      where: { id: 1, eventId: 1, paymentStatus: { not: "CANCELLED" } },
      data: { paymentStatus: "CANCELLED" },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "REGISTRATION_CANCELLED", "Registration", 1, { eventId: 1 })
    expect(revalidatePath).toHaveBeenCalledWith("/events/1/registrations")
  })

  it("returns error when registration belongs to a different event (IDOR guard)", async () => {
    mockSession("ADMIN")
    ;(prisma.registration.findUnique as jest.Mock).mockResolvedValue({ eventId: 99 })
    const result = await cancelRegistration(1, 1)
    expect(result).toEqual({ error: "Registration not found" })
    expect(prisma.registration.updateMany).not.toHaveBeenCalled()
  })

  it("is a no-op when already CANCELLED (idempotent — no re-write, no duplicate audit)", async () => {
    mockSession("ADMIN")
    ;(prisma.registration.findUnique as jest.Mock).mockResolvedValue({ eventId: 1, paymentStatus: "CANCELLED" })
    const result = await cancelRegistration(1, 1)
    expect(result).toBeUndefined()
    expect(prisma.registration.updateMany).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("cancels a PAID registration (refund path is allowed)", async () => {
    mockSession("ADMIN")
    ;(prisma.registration.findUnique as jest.Mock).mockResolvedValue({ eventId: 1, paymentStatus: "PAID" })
    ;(prisma.registration.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await cancelRegistration(1, 1)
    expect(prisma.registration.updateMany).toHaveBeenCalledWith({
      where: { id: 1, eventId: 1, paymentStatus: { not: "CANCELLED" } },
      data: { paymentStatus: "CANCELLED" },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "REGISTRATION_CANCELLED", "Registration", 1, { eventId: 1 })
  })

  it("returns not-found when the row is deleted between read and write", async () => {
    mockSession("ADMIN")
    ;(prisma.registration.findUnique as jest.Mock)
      .mockResolvedValueOnce({ eventId: 1, paymentStatus: "PENDING" })
      .mockResolvedValueOnce(null)
    ;(prisma.registration.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    const result = await cancelRegistration(1, 1)
    expect(result).toEqual({ error: "Registration not found" })
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("is a no-op when a concurrent cancel won the race", async () => {
    mockSession("ADMIN")
    ;(prisma.registration.findUnique as jest.Mock)
      .mockResolvedValueOnce({ eventId: 1, paymentStatus: "PENDING" })
      .mockResolvedValueOnce({ paymentStatus: "CANCELLED" })
    ;(prisma.registration.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    const result = await cancelRegistration(1, 1)
    expect(result).toBeUndefined()
    expect(logAudit).not.toHaveBeenCalled()
  })
})

describe("toggleAttendeeCheckIn", () => {
  it("returns error for VIEWER", async () => {
    mockSession("VIEWER")
    expect(await toggleAttendeeCheckIn(1, 1, true)).toEqual({ error: "Unauthorized" })
  })

  it("rejects when attendee belongs to a different event (IDOR)", async () => {
    mockSession("ADMIN")
    ;(prisma.attendee.findUnique as jest.Mock).mockResolvedValue({ registrationItem: { registration: { eventId: 99 } } })
    expect(await toggleAttendeeCheckIn(1, 1, true)).toEqual({ error: "Attendee not found" })
    expect(prisma.attendee.update).not.toHaveBeenCalled()
  })

  it("sets checkedInAt when checking in", async () => {
    mockSession("OFFICE_ADMIN")
    ;(prisma.attendee.findUnique as jest.Mock).mockResolvedValue({ registrationItem: { registration: { eventId: 1 } } })
    ;(prisma.attendee.update as jest.Mock).mockResolvedValue({})
    await toggleAttendeeCheckIn(5, 1, true)
    expect(prisma.attendee.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { checkedInAt: expect.any(Date) } })
    expect(logAudit).toHaveBeenCalledWith(1, "ATTENDEE_CHECKED_IN", "Attendee", 5, { eventId: 1 })
    expect(revalidatePath).toHaveBeenCalledWith("/events/1/check-in")
  })

  it("clears checkedInAt when checking out", async () => {
    mockSession("ADMIN")
    ;(prisma.attendee.findUnique as jest.Mock).mockResolvedValue({ registrationItem: { registration: { eventId: 1 } } })
    ;(prisma.attendee.update as jest.Mock).mockResolvedValue({})
    await toggleAttendeeCheckIn(5, 1, false)
    expect(prisma.attendee.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { checkedInAt: null } })
    expect(logAudit).toHaveBeenCalledWith(1, "ATTENDEE_CHECKED_OUT", "Attendee", 5, { eventId: 1 })
  })

  it("revalidates both the admin and organiser check-in pages", async () => {
    mockSession("ADMIN")
    ;(prisma.attendee.findUnique as jest.Mock).mockResolvedValue({ registrationItem: { registration: { eventId: 1 } } })
    ;(prisma.attendee.update as jest.Mock).mockResolvedValue({})
    await toggleAttendeeCheckIn(5, 1, true)
    expect(revalidatePath).toHaveBeenCalledWith("/events/1/check-in")
    expect(revalidatePath).toHaveBeenCalledWith("/my-events/1/check-in")
  })

  // EVENT_ORGANISER had no path to check attendees in for an event they
  // manage — the check was canEdit-only (ADMIN|PASTOR|OFFICE_ADMIN).
  describe("EVENT_ORGANISER", () => {
    it("rejects an organiser not assigned to this event", async () => {
      mockSession("EVENT_ORGANISER")
      ;(prisma.eventManager.findUnique as jest.Mock).mockResolvedValue(null)
      expect(await toggleAttendeeCheckIn(5, 1, true)).toEqual({ error: "Unauthorized" })
      expect(prisma.attendee.update).not.toHaveBeenCalled()
    })

    it("allows an organiser assigned to this event to check an attendee in", async () => {
      mockSession("EVENT_ORGANISER")
      ;(prisma.eventManager.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
      ;(prisma.attendee.findUnique as jest.Mock).mockResolvedValue({ registrationItem: { registration: { eventId: 1 } } })
      ;(prisma.attendee.update as jest.Mock).mockResolvedValue({})
      const result = await toggleAttendeeCheckIn(5, 1, true)
      expect(result).toBeUndefined()
      expect(prisma.attendee.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { checkedInAt: expect.any(Date) } })
    })

    it("still enforces the IDOR check for an assigned organiser", async () => {
      mockSession("EVENT_ORGANISER")
      ;(prisma.eventManager.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
      ;(prisma.attendee.findUnique as jest.Mock).mockResolvedValue({ registrationItem: { registration: { eventId: 99 } } })
      expect(await toggleAttendeeCheckIn(5, 1, true)).toEqual({ error: "Attendee not found" })
      expect(prisma.attendee.update).not.toHaveBeenCalled()
    })
  })
})

describe("resetEventRegistrations", () => {
  // $transaction([...]) resolves to the array of per-op results.
  const wireTransaction = () =>
    (prisma.$transaction as jest.Mock).mockResolvedValue([{ count: 3 }, { count: 1 }, { count: 2 }])

  it("returns Unauthorized for a non-ADMIN editor (PASTOR)", async () => {
    mockSession("PASTOR")
    const result = await resetEventRegistrations(1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("returns Unauthorized for OFFICE_ADMIN", async () => {
    mockSession("OFFICE_ADMIN")
    expect(await resetEventRegistrations(1)).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("returns Event not found for a missing event", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await resetEventRegistrations(1)).toEqual({ error: "Event not found" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("refuses to reset a published event", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, isPublished: true })
    expect(await resetEventRegistrations(1)).toEqual({
      error: "This event is published — reset is disabled.",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  // unpublish is a reversible one-click toggle, so a published event that
  // took PAID Stripe registrations could be unpublished then reset — irreversible
  // loss of paid records under the no-refund policy. Guard on registration
  // HISTORY, not publish state: refuse (and delete nothing) if any non-CANCELLED
  // registration exists, even on an unpublished event.
  it("refuses to reset an unpublished event with a PAID registration and deletes nothing", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, isPublished: false })
    ;(prisma.registration.count as jest.Mock).mockResolvedValue(1)
    const result = await resetEventRegistrations(1)
    expect(result).toEqual({ error: expect.stringContaining("registration") })
    expect(prisma.registration.count).toHaveBeenCalledWith({
      where: { eventId: 1, paymentStatus: { not: "CANCELLED" } },
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.registration.deleteMany).not.toHaveBeenCalled()
    expect(prisma.waitlist.deleteMany).not.toHaveBeenCalled()
    expect(prisma.checkoutSession.deleteMany).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("refuses to reset while a card checkout is OPEN and deletes nothing", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, isPublished: false })
    ;(prisma.registration.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.checkoutSession.count as jest.Mock).mockResolvedValue(1)
    const result = await resetEventRegistrations(1)
    expect(result).toEqual({ error: expect.stringContaining("payment is in progress") })
    expect(prisma.checkoutSession.count).toHaveBeenCalledWith({ where: { eventId: 1, status: "OPEN" } })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("deletes registrations, waitlist and checkout sessions for a draft event and logs counts", async () => {
    mockSession("ADMIN")
    ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({ id: 1, isPublished: false })
    ;(prisma.registration.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.checkoutSession.count as jest.Mock).mockResolvedValue(0)
    wireTransaction()
    const result = await resetEventRegistrations(1)
    expect(result).toBeUndefined()
    // Each deleteMany scoped to the event.
    expect(prisma.registration.deleteMany).toHaveBeenCalledWith({ where: { eventId: 1 } })
    expect(prisma.waitlist.deleteMany).toHaveBeenCalledWith({ where: { eventId: 1 } })
    expect(prisma.checkoutSession.deleteMany).toHaveBeenCalledWith({ where: { eventId: 1 } })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(logAudit).toHaveBeenCalledWith(1, "EVENT_REGISTRATIONS_RESET", "Event", 1, {
      deletedRegistrations: 3,
      deletedWaitlist: 1,
      deletedCheckouts: 2,
    })
    expect(revalidatePath).toHaveBeenCalledWith("/events/1/registrations")
  })
})
