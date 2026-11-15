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

  it("backoff stays within the cap", () => {
    for (let a = 1; a <= 10; a++) expect(serializationBackoffMs(a)).toBeLessThan(Math.min(200, 25 * 2 ** (a - 1)) + 1)
  })
})
