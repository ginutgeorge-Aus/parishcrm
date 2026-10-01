// src/lib/__tests__/errorDigest.test.ts
jest.mock("@/lib/prisma", () => ({
  prisma: {
    errorLog: { groupBy: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn() },
    routeViewDaily: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    appSetting: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  },
}))
jest.mock("@/lib/github", () => ({
  createIssue: jest.fn(),
  listOpenIssuesByLabel: jest.fn(),
}))
import { prisma } from "@/lib/prisma"
import { createIssue, listOpenIssuesByLabel } from "@/lib/github"
import { runErrorDigest, runErrorDigestOncePerWeek } from "@/lib/errorDigest"

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

describe("runErrorDigestOncePerWeek (in-app scheduler entry)", () => {
  const findUnique = prisma.appSetting.findUnique as jest.Mock
  const create = prisma.appSetting.create as jest.Mock
  const updateMany = prisma.appSetting.updateMany as jest.Mock
  const update = prisma.appSetting.update as jest.Mock
  const MON = new Date("2026-07-06T00:00:00Z") // Mon 2026-07-06 10:00 AEST
  const KEY = "errorDigestLastWeek"

  beforeEach(() => {
    jest.clearAllMocks()
    groupBy.mockResolvedValue([])
    deleteMany.mockResolvedValue({ count: 0 })
    ;(listOpenIssuesByLabel as jest.Mock).mockResolvedValue([])
  })

  it("claims the week atomically (compare-and-set on the previous value) and runs", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-06-29" })
    updateMany.mockResolvedValue({ count: 1 })
    await runErrorDigestOncePerWeek(MON)
    expect(updateMany).toHaveBeenCalledWith({ where: { key: KEY, value: "2026-06-29" }, data: { value: "2026-07-06" } })
    expect(groupBy).toHaveBeenCalled()
  })

  it("creates the marker on first ever run", async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({})
    await runErrorDigestOncePerWeek(MON)
    expect(create).toHaveBeenCalledWith({ data: { key: KEY, value: "2026-07-06" } })
    expect(groupBy).toHaveBeenCalled()
  })

  it("skips when this week is already claimed (survives restarts, so closed issues are not re-filed)", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-07-06" })
    const r = await runErrorDigestOncePerWeek(new Date("2026-07-08T00:00:00Z"))
    expect(groupBy).not.toHaveBeenCalled()
    expect(r).toEqual({ filed: 0, skipped: 0, purged: 0 })
  })

  it("skips when a concurrent process won the claim", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-06-29" })
    updateMany.mockResolvedValue({ count: 0 })
    await runErrorDigestOncePerWeek(MON)
    expect(groupBy).not.toHaveBeenCalled()
  })

  it("skips when a concurrent process created the marker first", async () => {
    findUnique.mockResolvedValue(null)
    create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
    await runErrorDigestOncePerWeek(MON)
    expect(groupBy).not.toHaveBeenCalled()
  })

  it("releases the claim when the digest throws, so it is retried", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: "2026-06-29" })
    updateMany.mockResolvedValue({ count: 1 })
    groupBy.mockRejectedValueOnce(new Error("db down"))
    await expect(runErrorDigestOncePerWeek(MON)).rejects.toThrow("db down")
    expect(update).toHaveBeenCalledWith({ where: { key: KEY }, data: { value: "2026-06-29" } })
  })
})
