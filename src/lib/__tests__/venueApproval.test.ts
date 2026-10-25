/** @jest-environment node */
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
import { logAuditTx } from "@/lib/audit"
import { clearApprovalTx, monthOfDate, UNSENT_FILTER } from "@/lib/venueApproval"

const makeTx = (approved: { id: number; month: string }[]) => ({
  venueUsageRequest: { findMany: jest.fn().mockResolvedValue(approved), updateMany: jest.fn().mockResolvedValue({ count: approved.length }) },
}) as never

beforeEach(() => jest.clearAllMocks())

it("monthOfDate reads the UTC calendar month", () => {
  expect(monthOfDate(new Date("2026-09-30T00:00:00Z"))).toBe("2026-09")
})
it("UNSENT_FILTER treats null and non-SUCCESS statuses as unsent", () => {
  expect(UNSENT_FILTER).toEqual({ OR: [{ status: null }, { status: { not: "SUCCESS" } }] })
})
it("clears approved unsent months once each and audits them", async () => {
  const tx = makeTx([{ id: 4, month: "2026-10" }])
  const cleared = await clearApprovalTx(tx, ["2026-10", "2026-10", "2026-11"], 7)
  expect(cleared).toEqual(["2026-10"])
  const t = tx as any
  const where = t.venueUsageRequest.findMany.mock.calls[0][0].where
  expect(where.month).toEqual({ in: ["2026-10", "2026-11"] })
  expect(where.approvedAt).toEqual({ not: null })
  expect(where.OR).toEqual(UNSENT_FILTER.OR)
  expect(t.venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { id: { in: [4] } }, data: { approvedAt: null, approvedById: null } })
  expect(logAuditTx).toHaveBeenCalledWith(tx, 7, "VENUE_APPROVAL_CLEARED", "VenueUsageRequest", 4, { month: "2026-10", reason: "dates changed" })
})
it("does nothing when no month is approved", async () => {
  const tx = makeTx([])
  expect(await clearApprovalTx(tx, ["2026-10"], 7)).toEqual([])
  expect((tx as any).venueUsageRequest.updateMany).not.toHaveBeenCalled()
})
