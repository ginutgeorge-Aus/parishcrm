// src/lib/__tests__/errorDigest.test.ts
jest.mock("@/lib/prisma", () => ({
  prisma: {
    errorLog: { groupBy: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn() },
    routeViewDaily: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}))
jest.mock("@/lib/github", () => ({
  createIssue: jest.fn(),
  listOpenIssuesByLabel: jest.fn(),
}))
import { prisma } from "@/lib/prisma"
import { createIssue, listOpenIssuesByLabel } from "@/lib/github"
import { runErrorDigest } from "@/lib/errorDigest"

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
