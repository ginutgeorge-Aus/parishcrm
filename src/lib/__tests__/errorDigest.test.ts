// src/lib/__tests__/errorDigest.test.ts
jest.mock("@/lib/prisma", () => ({
  prisma: {
    errorLog: { groupBy: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn() },
    routeViewDaily: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    appSetting: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  },
}))
jest.mock("@/lib/github", () => ({
  createIssue: jest.fn(),
  listOpenIssuesByLabel: jest.fn(),
}))
import { prisma } from "@/lib/prisma"
import { createIssue, listOpenIssuesByLabel } from "@/lib/github"
import { runErrorDigest, runErrorDigestLocked, runErrorDigestOncePerWeek } from "@/lib/errorDigest"

const groupBy = prisma.errorLog.groupBy as jest.Mock
const findFirst = prisma.errorLog.findFirst as jest.Mock
const deleteMany = prisma.errorLog.deleteMany as jest.Mock

describe("runErrorDigest", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    groupBy.mockResolvedValue([
      { fingerprint: "abc123", _count: { _all: 8 }, _min: { createdAt: new Date() }, _max: { createdAt: new Date() } },
    ])
    findFirst.mockResolvedValue({ errorType: "TypeError", message: "boom", route: "/people", method: "POST" })
    deleteMany.mockResolvedValue({ count: 3 })
  })

  it("files a new issue when no open issue carries the fingerprint marker", async () => {
    ;(listOpenIssuesByLabel as jest.Mock).mockResolvedValue([])
    ;(createIssue as jest.Mock).mockResolvedValue({ number: 99 })
    const r = await runErrorDigest(new Date())
    expect(createIssue).toHaveBeenCalledTimes(1)
    expect((createIssue as jest.Mock).mock.calls[0][0].body).toContain("<!-- fingerprint:abc123 -->")
    expect(r.filed).toBe(1)
    expect(r.purged).toBe(3)
  })

  it("skips when an open issue already carries the fingerprint marker", async () => {
    ;(listOpenIssuesByLabel as jest.Mock).mockResolvedValue([{ number: 5, body: "x <!-- fingerprint:abc123 --> y" }])
    const r = await runErrorDigest(new Date())
    expect(createIssue).not.toHaveBeenCalled()
    expect(r.skipped).toBe(1)
  })
})

describe("digest lock (runErrorDigestLocked / runErrorDigestOncePerWeek)", () => {
  const findUnique = prisma.appSetting.findUnique as jest.Mock
  const create = prisma.appSetting.create as jest.Mock
  const updateMany = prisma.appSetting.updateMany as jest.Mock
  const settingDeleteMany = prisma.appSetting.deleteMany as jest.Mock
  const MON = new Date("2026-07-06T00:00:00Z") // Mon 2026-07-06 10:00 AEST
  const KEY = "errorDigestLastWeek"
  const lease = (week: string, at: Date) => `running:${week}:${at.getTime()}`

  beforeEach(() => {
    jest.clearAllMocks()
    groupBy.mockResolvedValue([])
    deleteMany.mockResolvedValue({ count: 0 })
    ;(listOpenIssuesByLabel as jest.Mock).mockResolvedValue([])
    updateMany.mockResolvedValue({ count: 1 })
    settingDeleteMany.mockResolvedValue({ count: 1 })
    create.mockResolvedValue({})
  })

  it("takes a lease by compare-and-set, runs, then records the week as done", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-06-29" })
    await runErrorDigestOncePerWeek(MON)
    expect(updateMany).toHaveBeenNthCalledWith(1, { where: { key: KEY, value: "2026-06-29" }, data: { value: lease("2026-07-06", MON) } })
    expect(groupBy).toHaveBeenCalled()
    expect(updateMany).toHaveBeenNthCalledWith(2, { where: { key: KEY, value: lease("2026-07-06", MON) }, data: { value: "2026-07-06" } })
  })

  it("creates the lease on first ever run", async () => {
    findUnique.mockResolvedValue(null)
    await runErrorDigestOncePerWeek(MON)
    expect(create).toHaveBeenCalledWith({ data: { key: KEY, value: lease("2026-07-06", MON) } })
    expect(groupBy).toHaveBeenCalled()
  })

  it("skips when this week is already done (survives restarts, so closed issues are not re-filed)", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-07-06" })
    expect(await runErrorDigestOncePerWeek(new Date("2026-07-08T00:00:00Z"))).toEqual({ filed: 0, skipped: 0, purged: 0 })
    expect(groupBy).not.toHaveBeenCalled()
  })

  it("skips while another run holds a fresh lease", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: lease("2026-07-06", new Date(MON.getTime() - 5 * 60_000)) })
    expect(await runErrorDigestLocked(MON)).toBeNull()
    expect(groupBy).not.toHaveBeenCalled()
  })

  it("reclaims a stale lease left by a crashed run, so the week is not lost", async () => {
    const stale = lease("2026-07-06", new Date(MON.getTime() - 31 * 60_000))
    findUnique.mockResolvedValue({ key: KEY, value: stale })
    await runErrorDigestLocked(MON)
    expect(updateMany).toHaveBeenNthCalledWith(1, { where: { key: KEY, value: stale }, data: { value: lease("2026-07-06", MON) } })
    expect(groupBy).toHaveBeenCalled()
  })

  it("skips when a concurrent process won the compare-and-set", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-06-29" })
    updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await runErrorDigestLocked(MON)).toBeNull()
    expect(groupBy).not.toHaveBeenCalled()
  })

  it("skips when a concurrent process created the marker first", async () => {
    findUnique.mockResolvedValue(null)
    create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
    expect(await runErrorDigestLocked(MON)).toBeNull()
  })

  it("force (manual trigger) runs even when this week is already done", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-07-06" })
    await runErrorDigestLocked(MON, { force: true })
    expect(groupBy).toHaveBeenCalled()
  })

  it("force still respects a fresh lease (no overlapping runs)", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: lease("2026-07-06", MON) })
    expect(await runErrorDigestLocked(MON, { force: true })).toBeNull()
  })

  it("restores the previous value when the digest throws, and rethrows the original error", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-06-29" })
    groupBy.mockRejectedValueOnce(new Error("db down"))
    await expect(runErrorDigestLocked(MON)).rejects.toThrow("db down")
    expect(updateMany).toHaveBeenNthCalledWith(2, { where: { key: KEY, value: lease("2026-07-06", MON) }, data: { value: "2026-06-29" } })
  })

  it("rethrows the original error even if releasing the lease also fails (the lease then goes stale)", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-06-29" })
    groupBy.mockRejectedValueOnce(new Error("db down"))
    updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error("release failed"))
    const err = jest.spyOn(console, "error").mockImplementation(() => {})
    await expect(runErrorDigestLocked(MON)).rejects.toThrow("db down")
    expect(err).toHaveBeenCalledWith(expect.stringContaining("release failed"))
    err.mockRestore()
  })

  it("deletes its lease on failure when there was no previous marker", async () => {
    findUnique.mockResolvedValue(null)
    groupBy.mockRejectedValueOnce(new Error("db down"))
    await expect(runErrorDigestLocked(MON)).rejects.toThrow("db down")
    expect(settingDeleteMany).toHaveBeenCalledWith({ where: { key: KEY, value: lease("2026-07-06", MON) } })
  })
})
