/** @jest-environment node */
const errorDel = jest.fn()
const viewDel = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: { errorLog: { deleteMany: (a: unknown) => errorDel(a) }, routeViewDaily: { deleteMany: (a: unknown) => viewDel(a) } },
}))
import { runTelemetryPurge } from "@/lib/telemetryPurge"

const NOW = new Date("2026-07-01T00:00:00Z")
const CUTOFF = new Date("2026-04-02T00:00:00Z") // 90 days earlier

beforeEach(() => {
  errorDel.mockReset().mockResolvedValue({ count: 3 })
  viewDel.mockReset().mockResolvedValue({ count: 5 })
})

describe("runTelemetryPurge", () => {
  it("purges both tables older than 90 days, independent of ERROR_DIGEST", async () => {
    delete process.env.ERROR_DIGEST
    expect(await runTelemetryPurge(NOW)).toEqual({ errorLogs: 3, routeViews: 5 })
    expect(errorDel).toHaveBeenCalledWith({ where: { createdAt: { lt: CUTOFF } } })
    expect(viewDel).toHaveBeenCalledWith({ where: { date: { lt: CUTOFF } } })
  })

  it("still purges the second table when the first fails, then rethrows", async () => {
    errorDel.mockRejectedValue(new Error("db down"))
    await expect(runTelemetryPurge(NOW)).rejects.toThrow("db down")
    expect(viewDel).toHaveBeenCalledTimes(1)
  })
})
