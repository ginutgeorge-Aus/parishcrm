/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    serviceHeadcount: { upsert: jest.fn(), update: jest.fn(), delete: jest.fn() },
    serviceType: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/dates", () => ({ sydneyTodayYMD: jest.fn(() => "2026-11-12") }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { deleteHeadcount, saveHeadcount } from "@/lib/actions/attendance"

const as = (role: UserRole | undefined) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "9", role } } : null)
const p = prisma as unknown as {
  serviceHeadcount: { upsert: jest.Mock; update: jest.Mock; delete: jest.Mock }
  serviceType: { findUnique: jest.Mock }
  $transaction: jest.Mock
}
const audit = logAuditTx as jest.Mock

const valid = { date: "2026-11-08", serviceTypeId: 3, adults: 50, children: 12, notes: " hi " }

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.OFFICE_ADMIN)
  p.serviceType.findUnique.mockResolvedValue({ id: 3, isActive: true })
  p.serviceHeadcount.upsert.mockResolvedValue({ id: 11 })
  p.serviceHeadcount.update.mockResolvedValue({ id: 11 })
  p.serviceHeadcount.delete.mockResolvedValue({ id: 11, serviceDate: new Date("2026-11-08T00:00:00Z"), serviceTypeId: 3 })
})

describe("saveHeadcount", () => {
  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, undefined])(
    "rejects role %s",
    async (role) => {
      as(role)
      expect(await saveHeadcount(valid)).toEqual({ error: "Unauthorized" })
      expect(p.serviceHeadcount.upsert).not.toHaveBeenCalled()
    },
  )

  it("rejects a future date", async () => {
    const r = await saveHeadcount({ ...valid, date: "2026-11-13" })
    expect(r?.error).toBeTruthy()
    expect(p.serviceHeadcount.upsert).not.toHaveBeenCalled()
  })

  it("accepts today (Sydney) and back-dated dates", async () => {
    expect(await saveHeadcount({ ...valid, date: "2026-11-12" })).toBeUndefined()
    expect(await saveHeadcount({ ...valid, date: "2020-01-05" })).toBeUndefined()
  })

  it.each([
    ["negative adults", { adults: -1 }],
    ["fractional children", { children: 1.5 }],
    ["too large", { adults: 100001 }],
    ["NaN", { adults: Number.NaN }],
    ["bad date format", { date: "12/11/2026" }],
    ["impossible date", { date: "2026-02-30" }],
    ["bad type id", { serviceTypeId: 0 }],
  ])("rejects %s", async (_n, patch) => {
    const r = await saveHeadcount({ ...valid, ...patch })
    expect(r?.error).toBeTruthy()
    expect(p.serviceHeadcount.upsert).not.toHaveBeenCalled()
  })

  it("accepts 0 and 0 as a real count", async () => {
    expect(await saveHeadcount({ ...valid, adults: 0, children: 0 })).toBeUndefined()
    expect(p.serviceHeadcount.upsert).toHaveBeenCalled()
  })

  it("upserts on the unique key and writes an audit row in the transaction", async () => {
    const r = await saveHeadcount(valid)
    expect(r).toBeUndefined()
    const arg = p.serviceHeadcount.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({
      serviceDate_serviceTypeId: { serviceDate: new Date("2026-11-08T00:00:00.000Z"), serviceTypeId: 3 },
    })
    expect(arg.create).toMatchObject({ adults: 50, children: 12, notes: "hi", createdById: 9 })
    expect(arg.update).toEqual({ adults: 50, children: 12, notes: "hi" })
    expect(audit).toHaveBeenCalledWith(
      prisma, 9, "ATTENDANCE_SAVED", "ServiceHeadcount", 11,
      expect.objectContaining({ date: "2026-11-08", serviceTypeId: 3, adults: 50, children: 12 }),
    )
  })

  it("rejects an unknown service type", async () => {
    p.serviceType.findUnique.mockResolvedValue(null)
    expect((await saveHeadcount(valid))?.error).toBe("Service type not found")
    expect(p.serviceHeadcount.upsert).not.toHaveBeenCalled()
  })

  it("rejects an inactive service type", async () => {
    p.serviceType.findUnique.mockResolvedValue({ id: 3, isActive: false })
    expect((await saveHeadcount(valid))?.error).toBe("Service type is inactive")
    expect(p.serviceHeadcount.upsert).not.toHaveBeenCalled()
  })

  it("retries a concurrent-create P2002 as an update, not a raw error", async () => {
    p.serviceHeadcount.upsert.mockRejectedValueOnce({ code: "P2002" })
    const r = await saveHeadcount(valid)
    expect(r).toBeUndefined()
    expect(p.serviceHeadcount.update).toHaveBeenCalledTimes(1)
    expect(p.serviceHeadcount.update.mock.calls[0][0].data).toEqual({ adults: 50, children: 12, notes: "hi" })
    expect(audit).toHaveBeenCalledWith(prisma, 9, "ATTENDANCE_SAVED", "ServiceHeadcount", 11, expect.anything())
  })

  it("surfaces a non-P2002 database error", async () => {
    p.serviceHeadcount.upsert.mockRejectedValueOnce(new Error("boom"))
    await expect(saveHeadcount(valid)).rejects.toThrow("boom")
  })
})

describe("deleteHeadcount", () => {
  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, undefined])(
    "rejects role %s",
    async (role) => {
      as(role)
      expect(await deleteHeadcount(11)).toEqual({ error: "Unauthorized" })
      expect(p.serviceHeadcount.delete).not.toHaveBeenCalled()
    },
  )

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid id %s", async (id) => {
    expect(await deleteHeadcount(id)).toEqual({ error: "Invalid ID" })
  })

  it("deletes and audits", async () => {
    expect(await deleteHeadcount(11)).toBeUndefined()
    expect(p.serviceHeadcount.delete).toHaveBeenCalledWith({ where: { id: 11 } })
    expect(audit).toHaveBeenCalledWith(
      prisma, 9, "ATTENDANCE_DELETED", "ServiceHeadcount", 11,
      expect.objectContaining({ date: "2026-11-08", serviceTypeId: 3 }),
    )
  })

  it("maps a missing row (P2025) to a friendly error", async () => {
    p.serviceHeadcount.delete.mockRejectedValueOnce({ code: "P2025" })
    expect(await deleteHeadcount(11)).toEqual({ error: "Headcount not found" })
  })
})
