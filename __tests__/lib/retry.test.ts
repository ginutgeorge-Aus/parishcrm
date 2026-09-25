/** @jest-environment node */
import { withRetry } from "@/lib/retry"

// Immediate sleep so tests never wait on real timers.
const noSleep = () => Promise.resolve()

describe("withRetry", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = jest.fn().mockResolvedValue("ok")
    const res = await withRetry(fn, { sleep: noSleep })
    expect(res).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries a transient failure then succeeds", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok")
    const res = await withRetry(fn, { sleep: noSleep })
    expect(res).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("throws the last error after exhausting all attempts", async () => {
    const err = new Error("still down")
    const fn = jest.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("does not retry a non-retryable error", async () => {
    const err = Object.assign(new Error("auth"), { responseCode: 535 })
    const fn = jest.fn().mockRejectedValue(err)
    const isRetryable = (e: unknown) => (e as { responseCode?: number }).responseCode !== 535
    await expect(withRetry(fn, { isRetryable, sleep: noSleep })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("uses exponential backoff delays between attempts", async () => {
    const delays: number[] = []
    const sleep = (ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    }
    const fn = jest.fn().mockRejectedValue(new Error("x"))
    await expect(withRetry(fn, { attempts: 4, baseDelayMs: 100, sleep })).rejects.toThrow("x")
    // 3 sleeps before the 4 attempts' final throw: 100, 200, 400
    expect(delays).toEqual([100, 200, 400])
  })

  it("calls onRetry once per retry with the error and attempt number", async () => {
    const onRetry = jest.fn()
    const fn = jest.fn().mockRejectedValueOnce(new Error("a")).mockResolvedValueOnce("ok")
    await withRetry(fn, { onRetry, sleep: noSleep })
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1)
  })

  it("treats attempts < 1 as a single attempt", async () => {
    const fn = jest.fn().mockResolvedValue("ok")
    await withRetry(fn, { attempts: 0, sleep: noSleep })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
