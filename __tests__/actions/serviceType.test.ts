/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    serviceType: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pettyCashReceipt: { count: jest.fn() },
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { createServiceType, toggleServiceTypeActive, deleteServiceType } from "@/lib/actions/serviceType"

const mockAuth = auth as jest.Mock
const stFindFirst = prisma.serviceType.findFirst as jest.Mock
const stFindUnique = prisma.serviceType.findUnique as jest.Mock
const stCreate = prisma.serviceType.create as jest.Mock
const stDelete = prisma.serviceType.delete as jest.Mock
const rcCount = prisma.pettyCashReceipt.count as jest.Mock

const ADMIN = { user: { role: "ADMIN", id: "1" } }
const fd = (obj: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

beforeEach(() => jest.clearAllMocks())

describe("createServiceType", () => {
  it("maps a concurrent duplicate (P2002) to a friendly error", async () => {
    mockAuth.mockResolvedValue(ADMIN)
    stFindFirst.mockResolvedValue(null) // passes the check, then races
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
    expect(r).toEqual({ error: "Cannot delete — receipt(s) use this service type" })
  })
})
