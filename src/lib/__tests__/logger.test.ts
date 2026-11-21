/** @jest-environment node */
jest.mock("@/lib/errorCapture", () => ({
  captureError: jest.fn(),
  scrubContact: jest.requireActual("@/lib/errorCapture").scrubContact,
}))

import { logger } from "@/lib/logger"

describe("logger scrubbing", () => {
  afterEach(() => jest.restoreAllMocks())

  it("scrubs emails in the error field", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {})
    logger.warn("send failed", { error: "550 rejected someone@example.com", id: "x1" })
    const line = JSON.parse(spy.mock.calls[0][0] as string)
    expect(line.error).toContain("[email]")
    expect(line.error).not.toContain("someone@example.com")
    expect(line.id).toBe("x1")
  })

  it("scrubs emails in the message", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {})
    logger.info("mail to someone@example.com failed")
    const line = JSON.parse(log.mock.calls[0][0] as string)
    expect(line.message).not.toContain("someone@example.com")
  })

  it("leaves non-string error fields alone", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {})
    logger.warn("x", { error: 42 })
    expect(JSON.parse(spy.mock.calls[0][0] as string).error).toBe(42)
  })
})
