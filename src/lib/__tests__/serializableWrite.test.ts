/** @jest-environment node */
const transaction = jest.fn()
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: (...a: unknown[]) => transaction(...a) } }))

import { serializableWrite, serializationBackoffMs } from "@/lib/serializableWrite"

const p2034 = () => Object.assign(new Error("conflict"), { code: "P2034" })
const p2003 = () => Object.assign(new Error("fk"), { code: "P2003" })

describe("serializableWrite backoff", () => {
  let timeoutSpy: jest.SpyInstance
  beforeEach(() => {
    transaction.mockReset()
    timeoutSpy = jest.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
      fn()
      return 0
    }) as unknown as typeof setTimeout)
  })
  afterEach(() => timeoutSpy.mockRestore())

  it("sleeps between P2034 retries then succeeds", async () => {
    transaction.mockRejectedValueOnce(p2034()).mockRejectedValueOnce(p2034()).mockResolvedValueOnce("ok")
    await expect(serializableWrite(async () => "ok", { error: "busy" })).resolves.toBe("ok")
    expect(timeoutSpy).toHaveBeenCalledTimes(2)
  })

  it("returns busy without a trailing sleep after the last attempt", async () => {
    transaction.mockRejectedValue(p2034())
    await expect(serializableWrite(async () => "ok", { error: "busy" })).resolves.toEqual({ error: "busy" })
    expect(transaction).toHaveBeenCalledTimes(3)
    expect(timeoutSpy).toHaveBeenCalledTimes(2)
  })

  it("does not sleep on an FK retry", async () => {
    transaction.mockRejectedValueOnce(p2003()).mockResolvedValueOnce("ok")
    await expect(serializableWrite(async () => "ok", { error: "busy" })).resolves.toBe("ok")
    expect(timeoutSpy).not.toHaveBeenCalled()
  })

  it("each P2034 retry sleeps within [0, cap) for its attempt", async () => {
    transaction.mockRejectedValueOnce(p2034()).mockRejectedValueOnce(p2034()).mockResolvedValueOnce("ok")
    await serializableWrite(async () => "ok", { error: "busy" })
    const delays = timeoutSpy.mock.calls.map((c) => c[1] as number)
    expect(delays).toHaveLength(2)
    delays.forEach((d, i) => {
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThan(25 * 2 ** i)
    })
  })

  it("backoff stays within [0, cap) and the cap saturates at 200ms", () => {
    const cap = (a: number) => Math.min(200, 25 * 2 ** (a - 1))
    expect([cap(1), cap(2), cap(3), cap(4), cap(5), cap(10)]).toEqual([25, 50, 100, 200, 200, 200])
    for (let a = 1; a <= 10; a++) {
      for (let n = 0; n < 50; n++) {
        const d = serializationBackoffMs(a)
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThan(cap(a))
      }
    }
  })
})
