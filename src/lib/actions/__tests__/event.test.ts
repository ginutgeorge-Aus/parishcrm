/** @jest-environment node */
import { createEvent } from "@/lib/actions/event"
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
const findManyUser = jest.fn(async () => [{ id: 5, name: "Jo Organiser", email: "jo@example.com" }])
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { create: (arg: { data: Record<string, unknown> }) => create(arg), update: jest.fn() },
    eventImage: { upsert: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    user: { findMany: (...args: unknown[]) => findManyUser(...(args as [])) },
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
