/** @jest-environment node */
const getActiveSpan = jest.fn()
jest.mock("@opentelemetry/api", () => ({ trace: { getActiveSpan } }))
// captureError dynamic-imports prisma from onRequestError — mock it so
// tests never touch a real DB and stay fast/deterministic.
jest.mock("@/lib/prisma", () => ({ prisma: { errorLog: { create: jest.fn().mockResolvedValue({}) } } }))

import { onRequestError } from "@/instrumentation"

const request = { path: "/x", method: "GET" }
const context = { routerKind: "App Router", routePath: "/x", renderSource: "server" }

describe("onRequestError sampling", () => {
  const origRuntime = process.env.NEXT_RUNTIME
  const origConn = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_RUNTIME = "nodejs"
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = "InstrumentationKey=test"
  })

  afterAll(() => {
    process.env.NEXT_RUNTIME = origRuntime
    if (origConn === undefined) delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
    else process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = origConn
  })

  it("falls through to console.error on a non-recording (sampled-out) span", async () => {
    const recordException = jest.fn()
    getActiveSpan.mockReturnValue({ isRecording: () => false, recordException, setAttribute: jest.fn(), spanContext: () => ({ traceId: "1234567890abcdef1234567890abcdef" }) })
    const err = jest.spyOn(console, "error").mockImplementation(() => {})
    await onRequestError(new Error("boom"), request, context)
    expect(recordException).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })

  it("records on the span when it is recording (no console fallback)", async () => {
    const recordException = jest.fn()
    getActiveSpan.mockReturnValue({ isRecording: () => true, recordException, setAttribute: jest.fn(), spanContext: () => ({ traceId: "1234567890abcdef1234567890abcdef" }) })
    const err = jest.spyOn(console, "error").mockImplementation(() => {})
    await onRequestError(new Error("boom"), request, context)
    expect(recordException).toHaveBeenCalledTimes(1)
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it("uses console.error when there is no active span", async () => {
    getActiveSpan.mockReturnValue(undefined)
    const err = jest.spyOn(console, "error").mockImplementation(() => {})
    await onRequestError(new Error("boom"), request, context)
    expect(err).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})
