/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { updateManagedEvent } from "@/lib/actions/eventManaged"
import { auth } from "@/auth"
import { canManageEvent } from "@/lib/eventManager"
import { logAudit } from "@/lib/audit"
import { syncEventToWebsite } from "@/lib/websiteSync"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/eventManager", () => ({ canManageEvent: jest.fn() }))
jest.mock("@/lib/websiteSync", () => ({ syncEventToWebsite: jest.fn(async () => {}) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
}))

const findUnique = jest.fn()
const updateMany = jest.fn()
const prismaMock = {
  event: {
    findUnique: (...a: unknown[]) => findUnique(...a),
    updateMany: (...a: unknown[]) => updateMany(...a),
  },
  eventImage: { upsert: jest.fn(), deleteMany: jest.fn() },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}
// Lazy lookup: jest.mock is hoisted above the const declaration.
jest.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, k) => (prismaMock as Record<string | symbol, unknown>)[k] }),
}))

const stored = {
  id: 7, slug: "camp", kind: "one_off", title: "Old", description: null, category: "worship",
  date: new Date("2026-08-01T00:00:00Z"), endDate: null, recurs: null, recursLabel: null,
  startTime: null, location: null, organizers: null, registrationDeadline: null,
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}
const base = { title: "New title", category: "youth", date: "2026-08-02T10:00" }

async function run(fd: FormData, id = 7) {
  try {
    return await updateManagedEvent(id, undefined, fd)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("NEXT_REDIRECT")) return e.message
    throw e
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "EVENT_ORGANISER" } })
  ;(canManageEvent as jest.Mock).mockResolvedValue(true)
  findUnique.mockResolvedValue(stored)
  updateMany.mockResolvedValue({ count: 1 })
})

describe("updateManagedEvent authorisation", () => {
  it("rejects an unauthenticated caller", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    expect(await run(form(base))).toEqual({ error: "Unauthorized" })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("rejects a non-manager before touching the event (IDOR)", async () => {
    ;(canManageEvent as jest.Mock).mockResolvedValue(false)
    expect(await run(form(base), 99)).toEqual({ error: "Unauthorized" })
    expect(canManageEvent).toHaveBeenCalledWith(5, 99, "EVENT_ORGANISER")
    expect(findUnique).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("rejects an invalid id", async () => {
    expect(await run(form(base), -1)).toEqual({ error: "Invalid event" })
  })
})

describe("updateManagedEvent write", () => {
  it("writes only the detail columns, scoped to the event id", async () => {
    const out = await run(form({
      ...base,
      slug: "hijack", isPublished: "on", capacity: "1", bankBsb: "123-456", registrationDeadline: "2026-07-01T10:00",
    }))
    expect(out).toBe("NEXT_REDIRECT /my-events/7/edit?saved=1")
    const arg = updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> }
    expect(arg.where).toEqual({ id: 7 })
    expect(Object.keys(arg.data).sort()).toEqual(
      ["category", "date", "description", "endDate", "location", "organizers", "recurs", "recursLabel", "startTime", "title"],
    )
    expect(arg.data.title).toBe("New title")
  })

  it("guards the write on the last-seen updatedAt", async () => {
    await run(form({ ...base, updatedAt: "2026-08-01T00:00:00.000Z" }))
    const arg = updateMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(arg.where).toEqual({ id: 7, updatedAt: new Date("2026-08-01T00:00:00.000Z") })
  })

  it("reports a stale edit", async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const out = await run(form({ ...base, updatedAt: "2026-08-01T00:00:00.000Z" }))
    expect(out).toEqual({ error: expect.stringContaining("changed by someone else") })
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("refuses a date that would end before the stored registration deadline", async () => {
    findUnique.mockResolvedValue({ ...stored, registrationDeadline: new Date("2026-09-01T00:00:00Z") })
    const out = await run(form(base))
    expect(out).toEqual({ error: expect.stringContaining("registration deadline") })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("returns validation errors without writing", async () => {
    expect(await run(form({ title: "" }))).toEqual({ error: expect.any(String) })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("returns not-found for a missing event the caller may manage", async () => {
    findUnique.mockResolvedValue(null)
    expect(await run(form(base))).toEqual({ error: "Event not found" })
  })

  it("audits changed fields + role, syncs the website", async () => {
    await run(form(base))
    expect(logAudit).toHaveBeenCalledWith(
      5, "EVENT_UPDATED", "Event", 7,
      expect.objectContaining({ role: "EVENT_ORGANISER", fields: expect.arrayContaining(["title", "category", "date"]) }),
    )
    expect(syncEventToWebsite).toHaveBeenCalledWith(7)
  })
})
