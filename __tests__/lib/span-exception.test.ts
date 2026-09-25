/** @jest-environment node */
import { spanExceptionFor } from "@/instrumentation"

describe("spanExceptionFor — no stacktrace to App Insights", () => {
  it("keeps error name + message but strips the stack", () => {
    const err = new Error("boom")
    const payload = spanExceptionFor(err)
    expect(payload).toEqual({ name: "Error", message: "boom" })
    // The whole point of: exception.stacktrace must never reach the
    // Reader-visible App Insights exceptions table.
    expect("stack" in payload).toBe(false)
  })

  it("preserves a custom error subclass name", () => {
    class ValidationError extends Error {
      constructor(msg: string) {
        super(msg)
        this.name = "ValidationError"
      }
    }
    expect(spanExceptionFor(new ValidationError("bad field"))).toEqual({
      name: "ValidationError",
      message: "bad field",
    })
  })

  it("does not carry a message that could interpolate a field value as a stack", () => {
    const err = new Error("member 42 not found")
    const payload = spanExceptionFor(err)
    expect(payload.message).toBe("member 42 not found")
    expect(payload).not.toHaveProperty("stack")
  })
})
