// src/lib/__tests__/errorDigest.test.ts
jest.mock("@/lib/prisma", () => ({
  prisma: {
    errorLog: { groupBy: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn() },
    routeViewDaily: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
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
  const upsert = prisma.appSetting.upsert as jest.Mock
  const MON = new Date("2026-07-06T00:00:00Z") // Mon 2026-07-06 10:00 AEST

  beforeEach(() => {
    jest.clearAllMocks()
    groupBy.mockResolvedValue([])
    deleteMany.mockResolvedValue({ count: 0 })
    ;(listOpenIssuesByLabel as jest.Mock).mockResolvedValue([])
  })

  it("runs and records the Sydney week when it has not run this week", async () => {
    findUnique.mockResolvedValue(null)
    await runErrorDigestOncePerWeek(MON)
    expect(groupBy).toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: "errorDigestLastWeek" },
      update: { value: "2026-07-06" },
    }))
  })

  it("skips (survives restarts) when this week is already recorded, so closed issues are not re-filed", async () => {
    findUnique.mockResolvedValue({ key: "errorDigestLastWeek", value: "2026-07-06" })
    const r = await runErrorDigestOncePerWeek(new Date("2026-07-08T00:00:00Z"))
    expect(groupBy).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(r).toEqual({ filed: 0, skipped: 0, purged: 0 })
  })

  it("does not record the week when the digest throws, so it is retried", async () => {
    findUnique.mockResolvedValue(null)
    groupBy.mockRejectedValueOnce(new Error("db down"))
    await expect(runErrorDigestOncePerWeek(MON)).rejects.toThrow("db down")
    expect(upsert).not.toHaveBeenCalled()
  })
})
