/** @jest-environment node */
import { trace } from "@opentelemetry/api"
import { logger } from "@/lib/logger"

describe("logger", () => {
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {})
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  const parse = (spy: jest.SpyInstance) => JSON.parse(spy.mock.calls[0][0] as string)

  it("emits a single JSON line with level + message + ISO time", () => {
    logger.info("hello")
    expect(logSpy).toHaveBeenCalledTimes(1)
    const line = parse(logSpy)
    expect(line.level).toBe("info")
    expect(line.message).toBe("hello")
    expect(line.time).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it("merges extra fields", () => {
    logger.info("did thing", { userId: 7, count: 3 })
    const line = parse(logSpy)
    expect(line).toMatchObject({ message: "did thing", userId: 7, count: 3 })
  })

  it("routes warn to console.warn and error to console.error", () => {
    logger.warn("careful")
    logger.error("boom")
    expect(parse(warnSpy).level).toBe("warn")
    expect(parse(errorSpy).level).toBe("error")
    expect(logSpy).not.toHaveBeenCalled()
  })

  it("omits correlationId when no span is active", () => {
    logger.info("no span")
    expect(parse(logSpy)).not.toHaveProperty("correlationId")
  })

  it("uses the active span's traceId as correlationId", () => {
    const traceId = "abcdef0123456789abcdef0123456789"
    jest.spyOn(trace, "getActiveSpan").mockReturnValue({
      spanContext: () => ({ traceId, spanId: "0011223344556677", traceFlags: 1 }),
    } as never)
    logger.info("in request")
    expect(parse(logSpy).correlationId).toBe(traceId)
  })

  it("treats the all-zero trace id as no correlation", () => {
    jest.spyOn(trace, "getActiveSpan").mockReturnValue({
      spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 0 }),
    } as never)
    logger.info("invalid ctx")
    expect(parse(logSpy)).not.toHaveProperty("correlationId")
  })
})
