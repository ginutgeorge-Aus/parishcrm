/** @jest-environment node */
jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn(async () => {}),
  isAmbiguousDeliveryError: (e: unknown) =>
    typeof (e as { code?: string })?.code === "string" &&
    ["ETIMEDOUT", "ECONNRESET", "ESOCKET", "EPIPE"].includes((e as { code: string }).code),
}))
jest.mock("@/lib/celebrationClaim", () => ({ resolveCelebrationSend: jest.fn(async () => {}) }))

import { deliverCelebration } from "@/lib/celebrationDeliver"
import { sendEmail } from "@/lib/email"
import { resolveCelebrationSend } from "@/lib/celebrationClaim"
import { logger } from "@/lib/logger"

const send = sendEmail as jest.Mock
const resolve = resolveCelebrationSend as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  send.mockResolvedValue(undefined)
  resolve.mockResolvedValue(undefined)
})

test("delivered → resolves SENT, returns true (caller audits)", async () => {
  const ok = await deliverCelebration("to@x.com", "s", "<p>", "t", 7, "BIRTHDAY_EMAIL_SENT", "2026-06-15")
  expect(ok).toBe(true)
  expect(resolve).toHaveBeenCalledWith(7, "BIRTHDAY_EMAIL_SENT", "2026-06-15", "SENT")
})

test("clean pre-delivery send failure → FAILED (retryable), returns false", async () => {
  send.mockRejectedValueOnce(new Error("SMTP 550 rejected"))
  const ok = await deliverCelebration("to@x.com", "s", "<p>", "t", 7, "BIRTHDAY_EMAIL_SENT", "2026-06-15")
  expect(ok).toBe(false)
  expect(resolve).toHaveBeenCalledWith(7, "BIRTHDAY_EMAIL_SENT", "2026-06-15", "FAILED")
})

test("ambiguous post-submission send failure → UNKNOWN (terminal), never FAILED", async () => {
  send.mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ESOCKET" }))
  const ok = await deliverCelebration("to@x.com", "s", "<p>", "t", 7, "ANNIVERSARY_EMAIL_SENT", "2026-06-15")
  expect(ok).toBe(false)
  expect(resolve).toHaveBeenCalledWith(7, "ANNIVERSARY_EMAIL_SENT", "2026-06-15", "UNKNOWN")
  expect(resolve).not.toHaveBeenCalledWith(7, "ANNIVERSARY_EMAIL_SENT", "2026-06-15", "FAILED")
})

test("delivered but SENT write fails → falls back to terminal UNKNOWN, logs loudly, still returns true", async () => {
  resolve.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(undefined)
  const errSpy = jest.spyOn(logger, "error").mockImplementation(() => {})
  const ok = await deliverCelebration("to@x.com", "s", "<p>", "t", 7, "BIRTHDAY_EMAIL_SENT", "2026-06-15")
  expect(ok).toBe(true)
  expect(resolve).toHaveBeenNthCalledWith(1, 7, "BIRTHDAY_EMAIL_SENT", "2026-06-15", "SENT")
  expect(resolve).toHaveBeenNthCalledWith(2, 7, "BIRTHDAY_EMAIL_SENT", "2026-06-15", "UNKNOWN")
  expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/deliver|SENT|UNKNOWN/i))
  errSpy.mockRestore()
})
