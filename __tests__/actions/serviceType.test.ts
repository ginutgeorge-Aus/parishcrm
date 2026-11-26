/** @jest-environment node */

jest.mock("@/lib/featureFlags")
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    serviceType: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pettyCashReceipt: { count: jest.fn() },
    serviceHeadcount: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))

import { auth } from "@/auth"
import { logAudit, logAuditTx } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import { createServiceType, toggleServiceTypeActive, deleteServiceType } from "@/lib/actions/serviceType"

const mockAuth = auth as jest.Mock
const stFindMany = prisma.serviceType.findMany as jest.Mock
const stFindUnique = prisma.serviceType.findUnique as jest.Mock
const stCreate = prisma.serviceType.create as jest.Mock
const stDelete = prisma.serviceType.delete as jest.Mock
const hcCount = prisma.serviceHeadcount.count as jest.Mock
const stUpdate = prisma.serviceType.update as jest.Mock
const rcCount = prisma.pettyCashReceipt.count as jest.Mock

const ADMIN = { user: { role: "ADMIN", id: "1" } }
const fd = (obj: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  hcCount.mockResolvedValue(0)
  stFindMany.mockResolvedValue([])
  // Run the transaction callback against a tx whose delete is the shared stDelete mock.
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ serviceType: { delete: stDelete } }))
})

describe("createServiceType", () => {
  it("maps a concurrent duplicate (P2002) to a friendly error", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    stCreate.mockRejectedValue({ code: "P2002" })
    const r = await createServiceType(undefined, fd({ name: "Holy Communion" }))
    expect(r).toEqual({ error: "Service type already exists" })
  })
})

describe("toggleServiceTypeActive", () => {
  it("rejects an out-of-range id before hitting the DB", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const r = await toggleServiceTypeActive(2147483648)
    expect(r).toEqual({ error: "Invalid ID" })
    expect(stFindUnique).not.toHaveBeenCalled()
  })
})

describe("deleteServiceType", () => {
  it("rejects an out-of-range id before hitting the DB", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    const r = await deleteServiceType(-1)
    expect(r).toEqual({ error: "Invalid ID" })
    expect(rcCount).not.toHaveBeenCalled()
  })

  it("maps an FK race (P2003) on delete to a friendly error", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    rcCount.mockResolvedValue(0) // passes the count check, then a receipt is created
    stDelete.mockRejectedValue({ code: "P2003" })
    const r = await deleteServiceType(5)
    expect(r).toEqual({ error: "Cannot delete — records use this service type" })
  })
})

describe("service type hardening (AUD-5-24/25/27)", () => {
  it("trims the name so ' Sunday' and 'Sunday' are one type", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    stCreate.mockResolvedValue({ id: 9, name: "Sunday" })
    await expect(createServiceType(undefined, fd({ name: "  Sunday  " }))).rejects.toThrow("REDIRECT")
    expect(stCreate).toHaveBeenCalledWith({ data: { name: "Sunday" } })
  })
  it("rejects a whitespace-only name", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    expect(await createServiceType(undefined, fd({ name: "   " }))).toEqual({ error: "Name is required" })
  })
  it("blocks delete when headcounts use the type and says so", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    rcCount.mockResolvedValue(0)
    hcCount.mockResolvedValue(3)
    const r = await deleteServiceType(5)
    expect(r).toEqual({ error: "Cannot delete — 3 headcount record(s) use this service type" })
    expect(stDelete).not.toHaveBeenCalled()
  })
  it("audits create, toggle and delete", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    stCreate.mockResolvedValue({ id: 9, name: "Sunday" })
    await expect(createServiceType(undefined, fd({ name: "Sunday" }))).rejects.toThrow("REDIRECT")
    stFindUnique.mockResolvedValue({ id: 9, isActive: true })
    stUpdate.mockResolvedValue({})
    await toggleServiceTypeActive(9)
    rcCount.mockResolvedValue(0)
    stDelete.mockResolvedValue({})
    await deleteServiceType(9)
    const actions = (logAudit as jest.Mock).mock.calls.map((c) => c[1])
    expect(actions).toEqual(["SERVICE_TYPE_CREATED", "SERVICE_TYPE_TOGGLED"])
    // The delete audit commits inside the transaction (logAuditTx), never via logAudit.
    expect((logAuditTx as jest.Mock).mock.calls.map((c) => c[2])).toEqual(["SERVICE_TYPE_DELETED"])
  })
})

describe("createServiceType dedupe and audit placement", () => {
  it("treats a differently-cased existing name as a duplicate", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    stFindMany.mockResolvedValue([{ id: 1, name: " sunday" }])
    expect(await createServiceType(undefined, fd({ name: "Sunday" }))).toEqual({ error: "Service type already exists" })
    expect(stCreate).not.toHaveBeenCalled()
  })
  it("a failing audit write is not swallowed as a duplicate", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    stCreate.mockResolvedValue({ id: 9 })
    ;(logAudit as jest.Mock).mockRejectedValueOnce({ code: "P2002" })
    await expect(createServiceType(undefined, fd({ name: "Sunday" }))).rejects.toEqual({ code: "P2002" })
  })
})
