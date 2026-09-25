/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/github", () => ({ createIssue: jest.fn(), getIssue: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { report: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() } },
}))

import { submitFeedback, syncMyReports } from "@/lib/actions/feedback"
import { auth } from "@/auth"
import { createIssue, getIssue } from "@/lib/github"
import { logAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"

const mockAuth = auth as jest.Mock
const mockCreateIssue = createIssue as jest.Mock
const mockGetIssue = getIssue as jest.Mock
const mockLogAudit = logAudit as jest.Mock
const mockReportCreate = prisma.report.create as jest.Mock
const mockReportFindMany = prisma.report.findMany as jest.Mock
const mockReportUpdate = prisma.report.update as jest.Mock

const bugInput = {
  type: "BUG" as const,
  whatDoing: "Adding a new family",
  whatExpected: "The family to be saved",
  whatHappened: "Got a red error saying something went wrong",
  pageUrl: "/families",
  client: { userAgent: "Chrome/126.0", language: "en-AU", viewport: "1280×720" },
}

function session(over: Record<string, unknown> = {}) {
  return { user: { id: "7", role: "VIEWER", name: "Sam", ...over } }
}

describe("submitFeedback", () => {
  // Distinct session ids per test — the module-level rate-limit map persists across tests.
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateIssue.mockResolvedValue({ number: 99 })
    mockReportCreate.mockResolvedValue({})
  })

  it("rejects an unauthenticated request", async () => {
    mockAuth.mockResolvedValue(null)
    const result = await submitFeedback(bugInput)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreateIssue).not.toHaveBeenCalled()
    expect(mockReportCreate).not.toHaveBeenCalled()
  })

  it.each(["whatDoing", "whatExpected", "whatHappened"] as const)(
    "rejects an empty bug %s",
    async (field) => {
      mockAuth.mockResolvedValue(session({ id: "10" }))
      const result = await submitFeedback({ ...bugInput, [field]: "  " })
      expect(result).toHaveProperty("error")
      expect(mockCreateIssue).not.toHaveBeenCalled()
    }
  )

  it("files a BUG with a derived title, guided body, bug label, and mirror row", async () => {
    mockAuth.mockResolvedValue(session({ id: "12" }))
    const result = await submitFeedback(bugInput)
    expect(result).toEqual({ success: "Reported as issue #99" })

    const call = mockCreateIssue.mock.calls[0][0]
    expect(call.labels).toEqual(["bug"])
    expect(call.title).toBe("Bug: Got a red error saying something went wrong")
    expect(call.body).toContain("**What they were doing:** Adding a new family")
    expect(call.body).toContain("**What happened:** Got a red error saying something went wrong")
    expect(call.body).toContain("Chrome/126.0")

    expect(mockReportCreate).toHaveBeenCalledWith({
      data: {
        userId: 12,
        type: "BUG",
        title: "Bug: Got a red error saying something went wrong",
        summary: "Got a red error saying something went wrong",
        issueNumber: 99,
        pageUrl: "/families",
      },
    })
    expect(mockLogAudit).toHaveBeenCalledWith(12, "FEEDBACK_SUBMITTED", "Report", 99, {
      type: "BUG",
      pageUrl: "/families",
    })
  })

  it("files a FEATURE with an enhancement label and request body", async () => {
    mockAuth.mockResolvedValue(session({ id: "30" }))
    const result = await submitFeedback({
      type: "FEATURE",
      what: "Add a dark mode",
      why: "Easier on the eyes at night",
      pageUrl: "/",
    })
    expect(result).toHaveProperty("success")
    const call = mockCreateIssue.mock.calls[0][0]
    expect(call.labels).toEqual(["enhancement"])
    expect(call.title).toBe("Feature: Add a dark mode")
    expect(call.body).toContain("**Request:** Add a dark mode")
    expect(call.body).toContain("**Why it helps:** Easier on the eyes at night")
    expect(mockReportCreate.mock.calls[0][0].data.type).toBe("FEATURE")
    expect(mockReportCreate.mock.calls[0][0].data.summary).toBe("Add a dark mode")
  })

  it("files a SUGGESTION with a suggestion label; why is optional", async () => {
    mockAuth.mockResolvedValue(session({ id: "31" }))
    const result = await submitFeedback({ type: "SUGGESTION", what: "Rename the menu" })
    expect(result).toHaveProperty("success")
    const call = mockCreateIssue.mock.calls[0][0]
    expect(call.labels).toEqual(["suggestion"])
    expect(call.title).toBe("Suggestion: Rename the menu")
    expect(call.body).toContain("**Request:** Rename the menu")
    expect(call.body).not.toContain("**Why it helps:**")
  })

  it("rejects an empty idea request", async () => {
    mockAuth.mockResolvedValue(session({ id: "32" }))
    const result = await submitFeedback({ type: "FEATURE", what: "   " })
    expect(result).toHaveProperty("error")
    expect(mockCreateIssue).not.toHaveBeenCalled()
  })

  it("escapes markdown in the reporter name and omits the email", async () => {
    mockAuth.mockResolvedValue(session({ id: "22", name: "Sam [x](http://evil) `code`" }))
    await submitFeedback(bugInput)
    const body = mockCreateIssue.mock.calls[0][0].body as string
    expect(body).toContain("Sam \\[x\\](http://evil) \\`code\\`")
    expect(body).not.toContain("@")
  })

  it("rejects a pageUrl that is not an app-relative path", async () => {
    mockAuth.mockResolvedValue(session({ id: "20" }))
    const result = await submitFeedback({ ...bugInput, pageUrl: "![x](http://evil)" })
    expect(result).toEqual({ error: "Invalid page URL" })
    expect(mockCreateIssue).not.toHaveBeenCalled()
  })

  it("returns a generic error and writes no mirror row when createIssue throws", async () => {
    mockAuth.mockResolvedValue(session({ id: "13" }))
    mockCreateIssue.mockRejectedValue(new Error("GitHub issue creation failed: 401"))
    const result = await submitFeedback(bugInput)
    expect(result).toEqual({ error: "Could not file report. Try again later." })
    expect(mockReportCreate).not.toHaveBeenCalled()
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("rate-limits after 5 submits in the window for one user", async () => {
    mockAuth.mockResolvedValue(session({ id: "99" }))
    for (let i = 0; i < 5; i++) {
      expect(await submitFeedback(bugInput)).toHaveProperty("success")
    }
    expect(await submitFeedback(bugInput)).toEqual({ error: "Too many reports. Try again later." })
  })

  // a session that passed the `!session?.user` guard but carries a
  // malformed/missing id used to silently write NaN into the rate-limit key
  // and the Report row. actorId() now throws instead of parsing to NaN.
  it("throws instead of silently writing a NaN userId when the session id is malformed", async () => {
    mockAuth.mockResolvedValue(session({ id: "not-a-number" }))
    await expect(submitFeedback(bugInput)).rejects.toThrow(
      "Authenticated session is missing a valid user id"
    )
    expect(mockReportCreate).not.toHaveBeenCalled()
  })
})

describe("syncMyReports", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue(session({ id: "7" }))
    mockReportUpdate.mockResolvedValue({})
  })

  it("does nothing when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    await syncMyReports()
    expect(mockReportFindMany).not.toHaveBeenCalled()
  })

  it("updates a closed-as-completed open report to RESOLVED", async () => {
    mockReportFindMany.mockResolvedValue([{ id: 1, issueNumber: 50 }])
    mockGetIssue.mockResolvedValue({ state: "closed", stateReason: "completed" })

    await syncMyReports()

    expect(mockReportUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ status: "RESOLVED" }) })
    )
  })

  it("updates a closed-as-not-planned open report to DECLINED", async () => {
    mockReportFindMany.mockResolvedValue([{ id: 2, issueNumber: 51 }])
    mockGetIssue.mockResolvedValue({ state: "closed", stateReason: "not_planned" })

    await syncMyReports()

    expect(mockReportUpdate.mock.calls[0][0].data.status).toBe("DECLINED")
  })

  it("leaves a still-open issue unchanged but stamps syncedAt", async () => {
    mockReportFindMany.mockResolvedValue([{ id: 3, issueNumber: 52 }])
    mockGetIssue.mockResolvedValue({ state: "open", stateReason: null })

    await syncMyReports()

    expect(mockReportUpdate.mock.calls[0][0].data.status).toBe("OPEN")
  })

  it("swallows a GitHub error and does not update that row", async () => {
    mockReportFindMany.mockResolvedValue([{ id: 4, issueNumber: 53 }])
    mockGetIssue.mockRejectedValue(new Error("GitHub issue fetch failed: 404"))

    await expect(syncMyReports()).resolves.toBeUndefined()
    expect(mockReportUpdate).not.toHaveBeenCalled()
  })

  it("queries only the session user's OPEN, stale reports", async () => {
    mockReportFindMany.mockResolvedValue([])
    await syncMyReports()
    const where = mockReportFindMany.mock.calls[0][0].where
    expect(where.userId).toBe(7)
    expect(where.status).toBe("OPEN")
    expect(where.OR).toBeDefined()
    expect(mockGetIssue).not.toHaveBeenCalled()
  })

  it("throws instead of silently querying with a NaN userId when the session id is malformed", async () => {
    mockAuth.mockResolvedValue(session({ id: "" }))
    await expect(syncMyReports()).rejects.toThrow("Authenticated session is missing a valid user id")
    expect(mockReportFindMany).not.toHaveBeenCalled()
  })
})
