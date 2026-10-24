/** @jest-environment node */
import { FEATURES } from "@/lib/features"
import { finishFeatureOnboarding, saveFeatures } from "@/lib/actions/features"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAuditTx } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { invalidateFeatureRouteCache } from "@/lib/featureRoutes"

jest.mock("server-only", () => ({}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/featureRoutes", () => ({ invalidateFeatureRouteCache: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  // Writes go through a distinct tx client so tests prove they ran inside the callback.
  const findUnique = jest.fn()
  const txClient = { appSetting: { findUnique, upsert: jest.fn(), deleteMany: jest.fn() } }
  const p = { appSetting: { findUnique }, $transaction: jest.fn() }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(txClient))
  return { prisma: p, txClient }
})

const mockAuth = auth as jest.Mock
const findUnique = prisma.appSetting.findUnique as jest.Mock
const { txClient } = jest.requireMock("@/lib/prisma") as { txClient: { appSetting: { upsert: jest.Mock; deleteMany: jest.Mock } } }
const upsert = txClient.appSetting.upsert
const deleteMany = txClient.appSetting.deleteMany
const tx = prisma.$transaction as jest.Mock

const mockSession = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.DEMO_MODE
  findUnique.mockResolvedValue(null)
  deleteMany.mockResolvedValue({ count: 1 })
})

describe("finishFeatureOnboarding", () => {
  it("blocked in demo mode before auth or DB", async () => {
    process.env.DEMO_MODE = "true"
    mockSession("ADMIN")
    expect(await finishFeatureOnboarding()).toEqual({ error: "Disabled in the live demo" })
    expect(mockAuth).not.toHaveBeenCalled()
    expect(tx).not.toHaveBeenCalled()
  })

  it.each(["PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER"])("rejects %s", async (role) => {
    mockSession(role)
    expect(await finishFeatureOnboarding()).toEqual({ error: "Forbidden" })
    expect(tx).not.toHaveBeenCalled()
  })

  it("clears the flag and audits in one transaction, leaving overrides alone", async () => {
    mockSession("ADMIN")
    expect(await finishFeatureOnboarding()).toEqual({ success: "Default features kept" })
    expect(deleteMany).toHaveBeenCalledWith({ where: { key: "features.onboarding" } })
    expect(upsert).not.toHaveBeenCalled()
    expect(logAuditTx).toHaveBeenCalledWith(txClient, 1, "FINISH_FEATURE_ONBOARDING", "AppSetting", undefined, {
      key: "features.onboarding",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")
  })

  it("deletes and audits through the transaction client, not top-level prisma", async () => {
    mockSession("ADMIN")
    const seen: unknown[] = []
    deleteMany.mockImplementationOnce(async () => { seen.push("delete"); return { count: 1 } })
    ;(logAuditTx as jest.Mock).mockImplementationOnce(async () => { seen.push("audit") })
    let inside = false
    tx.mockImplementationOnce(async (fn: (t: unknown) => Promise<unknown>) => {
      inside = true
      const out = await fn(txClient)
      inside = false
      return out
    })
    await finishFeatureOnboarding()
    expect(seen).toEqual(["delete", "audit"])
    expect(inside).toBe(false)
    expect((logAuditTx as jest.Mock).mock.calls[0][0]).toBe(txClient)
  })

  it("skips the audit row when there was no flag, still succeeds", async () => {
    mockSession("ADMIN")
    deleteMany.mockResolvedValue({ count: 0 })
    expect(await finishFeatureOnboarding()).toEqual({ success: "Default features kept" })
    expect(logAuditTx).not.toHaveBeenCalled()
  })
})

describe("saveFeatures", () => {
  it.each(["PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER"])("rejects %s", async (role) => {
    mockSession(role)
    expect(await saveFeatures({ events: false })).toEqual({ error: "Forbidden" })
    expect(tx).not.toHaveBeenCalled()
  })

  it("rejects no session", async () => {
    mockAuth.mockResolvedValue(null)
    expect(await saveFeatures({ events: false })).toEqual({ error: "Forbidden" })
  })

  it("rejects unknown keys", async () => {
    mockSession("ADMIN")
    expect(await saveFeatures({ bogus: false } as never)).toEqual({ error: "Invalid feature settings" })
    expect(tx).not.toHaveBeenCalled()
  })

  it("rejects a partial map, so omitted keys can't silently reset to defaults", async () => {
    mockSession("ADMIN")
    expect(await saveFeatures({ events: false })).toEqual({ error: "Invalid feature settings" })
    expect(tx).not.toHaveBeenCalled()
  })

  it.each([null, [], "x", { events: "no" }])("rejects malformed input %p", async (input) => {
    mockSession("ADMIN")
    expect(await saveFeatures(input as never)).toEqual({ error: "Invalid feature settings" })
    expect(tx).not.toHaveBeenCalled()
  })

  it("stores only overrides differing from default, audits, clears onboarding flag", async () => {
    mockSession("ADMIN")
    findUnique.mockResolvedValue({ key: "features", value: '{"budget":false}' })
    const all = Object.fromEntries(FEATURES.map((f) => [f.key, f.defaultOn]))
    const res = await saveFeatures({ ...all, events: false, budget: true })
    expect(res).toEqual({ success: "Features saved" })
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "features" },
      create: { key: "features", value: '{"events":false}' },
      update: { value: '{"events":false}' },
    })
    expect(deleteMany).toHaveBeenCalledWith({ where: { key: "features.onboarding" } })
    expect(logAuditTx).toHaveBeenCalledWith(txClient, 1, "UPDATE_FEATURES", "AppSetting", undefined, {
      key: "features",
      before: { budget: false },
      after: { events: false },
    })
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")
    expect(invalidateFeatureRouteCache).toHaveBeenCalledTimes(1)
  })

  it("blocked in demo mode before auth", async () => {
    process.env.DEMO_MODE = "true"
    mockSession("ADMIN")
    expect(await saveFeatures({ events: false })).toEqual({ error: "Disabled in the live demo" })
    expect(mockAuth).not.toHaveBeenCalled()
    expect(tx).not.toHaveBeenCalled()
  })
})
