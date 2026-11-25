/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { createEvent, updateEvent } from "@/lib/actions/event"
import { listAssignableOrganisers } from "@/lib/actions/eventAccess"
import { auth } from "@/auth"

jest.mock("@/auth", () => ({ auth: jest.fn(async () => ({ user: { id: "1", role: "ADMIN" } })) }))
jest.mock("@/lib/websiteSync", () => ({
  syncEventToWebsite: jest.fn(async () => {}),
  syncEventDeletion: jest.fn(async () => {}),
  resyncAllEvents: jest.fn(async () => {}),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }),
}))

const create = jest.fn(async (_arg: { data: Record<string, unknown> }) => ({ id: 42 }))
const findUniqueEvent = jest.fn()
const updateManyEvent = jest.fn()
const findManyUser = jest.fn(async () => [{ id: 5, name: "Jo Organiser", email: "jo@example.com" }])
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: {
      create: (arg: { data: Record<string, unknown> }) => create(arg),
      update: jest.fn(),
      findUnique: (...a: unknown[]) => findUniqueEvent(...a),
      updateMany: (...a: unknown[]) => updateManyEvent(...a),
    },
    eventImage: { upsert: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    ticketType: { findMany: jest.fn(async () => []), createMany: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    user: { findMany: (...args: unknown[]) => findManyUser(...(args as [])) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(jest.requireMock("@/lib/prisma").prisma),
  },
}))

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const base = { title: "Camp", slug: "camp", kind: "one_off", date: "2026-08-01T10:00", category: "worship" }

async function run(fd: FormData) {
  try { await createEvent(undefined, fd) } catch (e) {
    if (!(e instanceof Error) || e.message !== "NEXT_REDIRECT") throw e
  }
}

describe("createEvent onlinePaymentEnabled", () => {
  beforeEach(() => jest.clearAllMocks())

  it("persists onlinePaymentEnabled=true when the checkbox is on", async () => {
    await run(form({ ...base, onlinePaymentEnabled: "on" }))
    expect(create).toHaveBeenCalled()
    expect(create.mock.calls[0][0].data.onlinePaymentEnabled).toBe(true)
  })

  it("defaults onlinePaymentEnabled=false when the checkbox is absent", async () => {
    await run(form(base))
    expect(create.mock.calls[0][0].data.onlinePaymentEnabled).toBe(false)
  })
})

describe("createEvent tiered pricing / family waiver validation", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects both tieredPricingEnabled and familyWaiverEnabled set", async () => {
    const result = await createEvent(undefined, form({ ...base, tieredPricingEnabled: "on", familyWaiverEnabled: "on" }))
    expect(result).toEqual({ error: "Enable either tiered pricing or the family waiver, not both" })
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects tieredPricingEnabled with no tier rows", async () => {
    const result = await createEvent(undefined, form({ ...base, tieredPricingEnabled: "on" }))
    expect(result).toEqual({ error: "Add at least one pricing tier" })
    expect(create).not.toHaveBeenCalled()
  })
})

describe("listAssignableOrganisers authz gate", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns [] for a non-editor role and skips prisma.user.findMany", async () => {
    ;(auth as jest.Mock).mockResolvedValueOnce({ user: { id: "1", role: "VIEWER" } })
    const result = await listAssignableOrganisers()
    expect(result).toEqual([])
    expect(findManyUser).not.toHaveBeenCalled()
  })

  it("returns EVENT_ORGANISER accounts for ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValueOnce({ user: { id: "1", role: "ADMIN" } })
    const result = await listAssignableOrganisers()
    expect(result).toEqual([{ id: 5, name: "Jo Organiser", email: "jo@example.com" }])
    expect(findManyUser).toHaveBeenCalled()
  })
})

// #3344: a moved event kept reminderSentAt, so its new date never got a reminder.
describe("updateEvent reminder re-arm (regression #3344: moved event never got a fresh reminder)", () => {
  const stored = { id: 9, isPublished: false, date: new Date("2026-08-01T00:00:00Z"), reminderDaysBefore: 3 }
  // 2026-08-01T10:00 Sydney (AEST, +10) = 2026-08-01T00:00Z, i.e. the stored date.
  const same = { ...base, reminderDaysBefore: "3" }

  async function runUpdate(fd: FormData) {
    try { await updateEvent(9, undefined, fd) } catch (e) {
      if (!(e instanceof Error) || e.message !== "NEXT_REDIRECT") throw e
    }
    return updateManyEvent.mock.calls[0][0] as { data: Record<string, unknown> }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    findUniqueEvent.mockResolvedValue(stored)
    updateManyEvent.mockResolvedValue({ count: 1 })
  })

  it("clears reminderSentAt (not the sweep lease) when the date changes", async () => {
    const arg = await runUpdate(form({ ...same, date: "2026-09-01T10:00" }))
    expect(arg.data.reminderSentAt).toBeNull()
    expect(arg.data).not.toHaveProperty("reminderClaimedAt")
  })

  it("clears reminderSentAt (not the sweep lease) when reminderDaysBefore changes", async () => {
    const arg = await runUpdate(form({ ...same, reminderDaysBefore: "5" }))
    expect(arg.data.reminderSentAt).toBeNull()
    expect(arg.data).not.toHaveProperty("reminderClaimedAt")
  })

  it("decides re-arm from the row read inside the transaction, not the earlier read", async () => {
    // Earlier existence read looks unchanged; the in-tx read shows a concurrent date move.
    findUniqueEvent
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce({ date: new Date("2026-12-01T00:00:00Z"), reminderDaysBefore: 3 })
    const arg = await runUpdate(form(same))
    expect(arg.data.reminderSentAt).toBeNull()
    expect(arg.data).not.toHaveProperty("reminderClaimedAt")
  })

  describe("after a reminder was sent", () => {
    const sent = { ...stored, kind: "one_off", isPublished: true, reminderSentAt: new Date("2026-07-30T00:00:00Z") }
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z"), advanceTimers: true })
      findUniqueEvent.mockResolvedValue(sent)
    })
    afterEach(() => jest.useRealTimers())

    it("keeps the marker on a time fix when the new schedule is already due", async () => {
      // 2026-08-01T12:00 Sydney = 02:00Z, 3-day window already open.
      const arg = await runUpdate(form({ ...same, date: "2026-08-01T12:00" }))
      expect(arg.data).not.toHaveProperty("reminderSentAt")
      expect(arg.data).not.toHaveProperty("reminderClaimedAt")
    })

    it("keeps the marker on an unpublished event whose new schedule is already due", async () => {
      findUniqueEvent.mockResolvedValue({ ...sent, isPublished: false })
      const arg = await runUpdate(form({ ...same, date: "2026-08-01T12:00" }))
      expect(arg.data).not.toHaveProperty("reminderSentAt")
    })

    it("keeps the marker when the reminder is turned off", async () => {
      const arg = await runUpdate(form({ ...same, reminderDaysBefore: "" }))
      expect(arg.data).not.toHaveProperty("reminderSentAt")
    })

    it("keeps the marker when the kind changes to recurring (date moved too, so the kind rule decides)", async () => {
      const arg = await runUpdate(form({ ...same, date: "2026-09-01T10:00", kind: "recurring", recurs: "every-sunday" }))
      expect(arg.data).not.toHaveProperty("reminderSentAt")
    })

    it("clears the marker when the event moves to a future schedule", async () => {
      const arg = await runUpdate(form({ ...same, date: "2026-09-01T10:00" }))
      expect(arg.data.reminderSentAt).toBeNull()
      expect(arg.data).not.toHaveProperty("reminderClaimedAt")
    })
  })

  it("does not re-arm when the in-tx read finds no row", async () => {
    findUniqueEvent.mockResolvedValueOnce(stored).mockResolvedValueOnce(null)
    const arg = await runUpdate(form({ ...same, date: "2026-09-01T10:00" }))
    expect(arg.data).not.toHaveProperty("reminderSentAt")
  })

  it("does not clear them when only the title changes", async () => {
    const arg = await runUpdate(form({ ...same, title: "Renamed" }))
    expect(arg.data).not.toHaveProperty("reminderSentAt")
    expect(arg.data).not.toHaveProperty("reminderClaimedAt")
  })
})
