import { markWorking, markBroken } from "@/lib/actions/checkpoint"
import { TEST_CHECKPOINTS } from "@/lib/testCheckpoints"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { createIssue } from "@/lib/github"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/github", () => ({ createIssue: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    checkpointResult: { upsert: jest.fn() },
    report: { create: jest.fn() },
  },
}))

const mockAuth = auth as jest.Mock
const mockCreateIssue = createIssue as jest.Mock
const mockUpsert = prisma.checkpointResult.upsert as jest.Mock
const mockReportCreate = prisma.report.create as jest.Mock
const validId = TEST_CHECKPOINTS[0].id

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN", name: "Admin" } })
})

describe("markWorking", () => {
  it("rejects non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "2", role: "VIEWER" } })
    expect(await markWorking(validId)).toEqual({ error: "Unauthorized" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects unknown checkpoint", async () => {
    expect(await markWorking("nope")).toEqual({ error: "Unknown checkpoint" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("upserts WORKING for a known checkpoint", async () => {
    mockUpsert.mockResolvedValue({})
    const res = await markWorking(validId)
    expect(res).toEqual({ success: "Marked working" })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { checkpointId: validId },
        create: expect.objectContaining({ checkpointId: validId, status: "WORKING", testedById: 1 }),
        update: expect.objectContaining({ status: "WORKING", testedById: 1 }),
      }),
    )
  })
})

describe("markBroken", () => {
  it("rejects non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "2", role: "PASTOR" } })
    expect(await markBroken(validId, "broke")).toEqual({ error: "Unauthorized" })
  })

  it("rejects unknown checkpoint", async () => {
    expect(await markBroken("nope", "broke")).toEqual({ error: "Unknown checkpoint" })
  })

  it("rejects empty note", async () => {
    expect(await markBroken(validId, "   ")).toEqual({ error: "A note is required" })
    expect(mockCreateIssue).not.toHaveBeenCalled()
  })

  it("files issue, writes report + result on success", async () => {
    mockCreateIssue.mockResolvedValue({ number: 42 })
    mockUpsert.mockResolvedValue({})
    mockReportCreate.mockResolvedValue({})
    const res = await markBroken(validId, "button does nothing")
    expect(res).toEqual({ success: "Filed as issue #42" })
    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["bug"] }),
    )
    expect(mockReportCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "BUG", issueNumber: 42, userId: 1 }),
      }),
    )
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "BROKEN", issueNumber: 42 }),
      }),
    )
  })

  it("writes nothing when issue filing fails", async () => {
    mockCreateIssue.mockRejectedValue(new Error("GitHub 401 token leak"))
    const res = await markBroken(validId, "broke")
    expect(res).toEqual({ error: "Could not file the bug. Try again later." })
    expect(mockReportCreate).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
