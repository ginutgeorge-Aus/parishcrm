/** @jest-environment node */

jest.mock("@/lib/github", () => ({ createIssue: jest.fn() }))
jest.mock("@/lib/turnstile", () => ({ verifyTurnstile: jest.fn() }))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: () => "9.9.9.9, 10.0.0.1" }),
}))

import { submitPublicFeedback } from "@/lib/actions/publicFeedback"
import { createIssue } from "@/lib/github"
import { verifyTurnstile } from "@/lib/turnstile"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { sendEmail } from "@/lib/email"
import { prisma } from "@/lib/prisma"

const mockCreateIssue = createIssue as jest.Mock
const mockVerify = verifyTurnstile as jest.Mock
const mockRateLimit = dbRateLimit as jest.Mock
const mockSendEmail = sendEmail as jest.Mock
const mockSetting = prisma.appSetting.findUnique as jest.Mock

const bug = {
  type: "BUG" as const,
  whatDoing: "Registering for an event",
  whatExpected: "A confirmation",
  whatHappened: "An error appeared",
  pageUrl: "/e/carols",
}
const feedback = { type: "FEEDBACK" as const, what: "Add a map to event pages" }

const flush = () => new Promise((r) => setImmediate(r))

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateIssue.mockResolvedValue({ number: 42 })
  mockVerify.mockResolvedValue(true)
  mockRateLimit.mockResolvedValue(true)
  mockSetting.mockResolvedValue({ value: "office@church.test" })
})

it("rejects a filled honeypot silently", async () => {
  const r = await submitPublicFeedback({ ...bug, website: "spam" })
  expect(r).toEqual({ error: "Submission failed" })
  expect(mockCreateIssue).not.toHaveBeenCalled()
})

it.each(["whatDoing", "whatExpected", "whatHappened"] as const)("rejects empty bug %s", async (f) => {
  const r = await submitPublicFeedback({ ...bug, [f]: "  " })
  expect(r).toHaveProperty("error")
  expect(mockCreateIssue).not.toHaveBeenCalled()
})

it("files a BUG labeled public + bug and returns success", async () => {
  const r = await submitPublicFeedback(bug)
  expect(r).toEqual({ success: "Thanks — your report has been sent to the parish office." })
  const call = mockCreateIssue.mock.calls[0][0]
  expect(call.labels).toEqual(["bug", "public"])
  expect(call.title).toBe("Bug: An error appeared")
  expect(call.body).toContain("- Reporter: Public visitor")
})

it("files FEEDBACK labeled public + enhancement", async () => {
  await submitPublicFeedback(feedback)
  expect(mockCreateIssue.mock.calls[0][0].labels).toEqual(["enhancement", "public"])
})

it("fails closed when Turnstile rejects", async () => {
  mockVerify.mockResolvedValue(false)
  const r = await submitPublicFeedback(bug)
  expect(r).toEqual({ error: "Verification failed. Please try again." })
  expect(mockCreateIssue).not.toHaveBeenCalled()
})

it("verifies Turnstile with the rightmost x-forwarded-for IP", async () => {
  await submitPublicFeedback(bug)
  expect(mockVerify).toHaveBeenCalledWith(undefined, "10.0.0.1")
  expect(mockRateLimit).toHaveBeenCalledWith("pubfeedback:ip:10.0.0.1", 5, 3600000)
})

it("blocks when rate-limited", async () => {
  mockRateLimit.mockResolvedValue(false)
  const r = await submitPublicFeedback(bug)
  expect(r).toEqual({ error: "Too many reports. Please try again later." })
  expect(mockCreateIssue).not.toHaveBeenCalled()
})

it("returns a generic error when createIssue throws, nothing emailed", async () => {
  mockCreateIssue.mockRejectedValue(new Error("gh boom"))
  const r = await submitPublicFeedback(bug)
  expect(r).toEqual({ error: "Could not send your report. Please try again later." })
  await flush()
  expect(mockSendEmail).not.toHaveBeenCalled()
})

it("emails the church with the contact address when provided", async () => {
  await submitPublicFeedback({ ...feedback, reporterEmail: "visitor@example.com" })
  await flush()
  expect(mockSendEmail).toHaveBeenCalledTimes(1)
  const [to, , html] = mockSendEmail.mock.calls[0]
  expect(to).toBe("office@church.test")
  expect(html).toContain("visitor@example.com")
})

it("renders the church email with HTML <strong>, not raw markdown, and does not re-escape values", async () => {
  await submitPublicFeedback({ ...feedback, what: "Add a *map* to event pages" })
  await flush()
  const [, , html, text] = mockSendEmail.mock.calls[0]
  // HTML email must use <strong>, never leak the issue-body markdown/escapes.
  expect(html).toContain("<strong>Feedback:</strong> Add a *map* to event pages")
  expect(html).not.toContain("**Feedback:**")
  expect(html).not.toContain("\\*")
  // Plain-text part is likewise un-escaped.
  expect(text).toContain("Feedback: Add a *map* to event pages")
})

it("still succeeds and does not email when ownerNotificationEmail is unset", async () => {
  mockSetting.mockResolvedValue(null)
  const r = await submitPublicFeedback(bug)
  expect(r).toHaveProperty("success")
  await flush()
  expect(mockSendEmail).not.toHaveBeenCalled()
})

it("rejects an invalid reporterEmail but accepts an empty string", async () => {
  const bad = await submitPublicFeedback({ ...feedback, reporterEmail: "not-an-email" })
  expect(bad).toHaveProperty("error")
  const ok = await submitPublicFeedback({ ...feedback, reporterEmail: "" })
  expect(ok).toHaveProperty("success")
})

it("never leaks reporterEmail into the GitHub issue", async () => {
  await submitPublicFeedback({ ...bug, reporterEmail: "visitor@example.com" })
  const call = mockCreateIssue.mock.calls[0][0]
  expect(call.title).not.toContain("visitor@example.com")
  expect(call.body).not.toContain("visitor@example.com")
})

it("still succeeds when the notification email send fails", async () => {
  mockSendEmail.mockRejectedValue(new Error("smtp down"))
  const r = await submitPublicFeedback(bug)
  expect(r).toHaveProperty("success")
  await flush()
})
