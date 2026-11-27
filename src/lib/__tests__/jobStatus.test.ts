/** @jest-environment node */
import { prisma } from "@/lib/prisma"
import { recordHeartbeat, recordJobSuccess, readJobLastSuccess, schedulerHealth, HEARTBEAT_KEY } from "@/lib/jobStatus"

jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { upsert: jest.fn(), findUnique: jest.fn() } } }))
const upsert = prisma.appSetting.upsert as jest.Mock
const findUnique = prisma.appSetting.findUnique as jest.Mock
const NOW = new Date(Date.now() + 3600_000) // an hour after this process booted
const ON = { IN_APP_CRON: "true" }

beforeEach(() => jest.resetAllMocks())

describe("jobStatus", () => {
  it("upserts heartbeat and last-success as ISO strings", async () => {
    await recordHeartbeat(NOW)
    await recordJobSuccess("reminders", NOW)
    expect(upsert).toHaveBeenCalledWith({ where: { key: HEARTBEAT_KEY }, create: { key: HEARTBEAT_KEY, value: NOW.toISOString() }, update: { value: NOW.toISOString() } })
    expect(upsert.mock.calls[1][0].where.key).toBe("job.lastSuccess.reminders")
  })

  it("never throws when the DB write fails", async () => {
    upsert.mockRejectedValue(new Error("down"))
    await expect(recordHeartbeat(NOW)).resolves.toBeUndefined()
    await expect(recordJobSuccess("x", NOW)).resolves.toBeUndefined()
  })

  it("reads last success; null when missing or garbage", async () => {
    findUnique.mockResolvedValueOnce({ value: NOW.toISOString() })
    expect(await readJobLastSuccess("a")).toEqual(NOW)
    findUnique.mockResolvedValueOnce(null)
    expect(await readJobLastSuccess("a")).toBeNull()
    findUnique.mockResolvedValueOnce({ value: "junk" })
    expect(await readJobLastSuccess("a")).toBeNull()
  })

  it("schedulerHealth: off, unknown, ok, stale, db error", async () => {
    expect(await schedulerHealth(NOW, { IN_APP_CRON: "false" })).toBe("off")
    findUnique.mockResolvedValueOnce(null)
    expect(await schedulerHealth(NOW, ON)).toBe("unknown")
    findUnique.mockResolvedValueOnce({ value: new Date(NOW.getTime() - 6 * 60_000).toISOString() })
    expect(await schedulerHealth(NOW, ON)).toBe("ok")
    findUnique.mockResolvedValueOnce({ value: new Date(NOW.getTime() - 16 * 60_000).toISOString() })
    expect(await schedulerHealth(NOW, ON)).toBe("stale")
    findUnique.mockRejectedValueOnce(new Error("down"))
    expect(await schedulerHealth(NOW, ON)).toBe("unknown")
  })

  it("schedulerHealth: old heartbeat just after boot is unknown, not stale", async () => {
    findUnique.mockResolvedValueOnce({ value: new Date(Date.now() - 3600_000).toISOString() })
    expect(await schedulerHealth(new Date(), ON)).toBe("unknown")
  })
})
