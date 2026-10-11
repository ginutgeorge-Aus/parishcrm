/** @jest-environment node */
const mockFindUnique = jest.fn()
const mockUpdateMany = jest.fn()
const mockDeleteMany = jest.fn()
const mockCreate = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: {
      findUnique: (a: unknown) => mockFindUnique(a),
      updateMany: (a: unknown) => mockUpdateMany(a),
      deleteMany: (a: unknown) => mockDeleteMany(a),
      create: (a: unknown) => mockCreate(a),
    },
  },
}))

import { LeaseLostError, runOncePerPeriodLocked } from "@/lib/periodLease"

const START = Date.UTC(2026, 9, 1)
const LEASE_MS = 3_000

/** Options for a run that starts at START with a 3 s lease. */
function opts(logError = jest.fn()) {
  return { settingKey: "k", periodKey: "2026-10", leaseMs: LEASE_MS, now: new Date(START), logError }
}

/** A promise plus its resolver, to hold `fn` open while timers advance. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe("runOncePerPeriodLocked lease heartbeat", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: START })
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({})
    mockUpdateMany.mockResolvedValue({ count: 1 })
  })
  afterEach(() => jest.useRealTimers())

  it("renews the lease while a long run is active and marks done from the latest lease", async () => {
    const work = deferred()
    const run = runOncePerPeriodLocked(opts(), () => work.promise.then(() => "ok"))
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: { key: "k", value: `running:2026-10:${START}` },
      data: { value: `running:2026-10:${START + LEASE_MS / 3}` },
    })
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    const latest = `running:2026-10:${START + (2 * LEASE_MS) / 3}`
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: { key: "k", value: `running:2026-10:${START + LEASE_MS / 3}` },
      data: { value: latest },
    })
    work.resolve()
    await expect(run).resolves.toBe("ok")
    expect(mockUpdateMany).toHaveBeenLastCalledWith({ where: { key: "k", value: latest }, data: { value: "2026-10" } })
    const renewals = mockUpdateMany.mock.calls.length
    await jest.advanceTimersByTimeAsync(LEASE_MS * 2)
    expect(mockUpdateMany).toHaveBeenCalledTimes(renewals)
  })

  it("releases the latest lease when the run throws", async () => {
    const work = deferred()
    const run = runOncePerPeriodLocked(opts(), () => work.promise.then(() => { throw new Error("boom") }))
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    work.resolve()
    await expect(run).rejects.toThrow("boom")
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { key: "k", value: `running:2026-10:${START + LEASE_MS / 3}` } })
  })

  it("logs and stops renewing when another run has taken the lease", async () => {
    const logError = jest.fn()
    const work = deferred()
    const run = runOncePerPeriodLocked(opts(logError), () => work.promise.then(() => "ok"))
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("lease lost"))
    const calls = mockUpdateMany.mock.calls.length
    await jest.advanceTimersByTimeAsync(LEASE_MS)
    expect(mockUpdateMany).toHaveBeenCalledTimes(calls)
    work.resolve()
    await run
  })

  it("keeps the current lease and retries when a renewal write fails", async () => {
    const logError = jest.fn()
    const work = deferred()
    const run = runOncePerPeriodLocked(opts(logError), () => work.promise.then(() => "ok"))
    mockUpdateMany.mockRejectedValueOnce(new Error("db down"))
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("db down"))
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: { key: "k", value: `running:2026-10:${START}` },
      data: { value: `running:2026-10:${START + (2 * LEASE_MS) / 3}` },
    })
    work.resolve()
    await run
  })
})

describe("runOncePerPeriodLocked lease heartbeat — edge cases", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: START })
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({})
    mockUpdateMany.mockResolvedValue({ count: 1 })
  })
  afterEach(() => jest.useRealTimers())

  it("adopts the new lease when a renewal errors but committed", async () => {
    const work = deferred()
    const run = runOncePerPeriodLocked(opts(), () => work.promise.then(() => "ok"))
    const renewed = `running:2026-10:${START + LEASE_MS / 3}`
    mockUpdateMany.mockRejectedValueOnce(new Error("connection reset"))
    mockFindUnique.mockResolvedValueOnce({ key: "k", value: renewed })
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: { key: "k", value: renewed },
      data: { value: `running:2026-10:${START + (2 * LEASE_MS) / 3}` },
    })
    work.resolve()
    await run
  })

  it("keeps a run past leaseMs exclusive against a competing invocation", async () => {
    const work = deferred()
    const run = runOncePerPeriodLocked(opts(), () => work.promise.then(() => "ok"))
    await jest.advanceTimersByTimeAsync(LEASE_MS * 2)
    const latest = (mockUpdateMany.mock.lastCall?.[0] as { data: { value: string } }).data.value
    expect(latest).toBe(`running:2026-10:${START + LEASE_MS * 2}`)
    mockFindUnique.mockResolvedValueOnce({ key: "k", value: latest })
    const rival = jest.fn()
    await expect(
      runOncePerPeriodLocked({ ...opts(), now: new Date(Date.now()) }, rival),
    ).resolves.toBe("locked")
    expect(rival).not.toHaveBeenCalled()
    work.resolve()
    await run
  })
})

describe("runOncePerPeriodLocked lease loss", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: START })
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({})
    mockUpdateMany.mockResolvedValue({ count: 1 })
  })
  afterEach(() => jest.useRealTimers())

  it("tells the work its lease is lost, and reports 'locked' when it stops", async () => {
    const work = deferred()
    const seen: boolean[] = []
    const run = runOncePerPeriodLocked(opts(), async (leaseHeld) => {
      seen.push(leaseHeld())
      await work.promise
      seen.push(leaseHeld())
      if (!leaseHeld()) throw new LeaseLostError()
      return "ok"
    })
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    work.resolve()
    await expect(run).resolves.toBe("locked")
    expect(seen).toEqual([true, false])
    // The new owner's row is left alone: no release, no done-marking.
    expect(mockDeleteMany).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { value: "2026-10" } }))
  })

  it("marks the lease lost when a failed renewal's readback shows a foreign value", async () => {
    const logError = jest.fn()
    const work = deferred()
    const run = runOncePerPeriodLocked(opts(logError), async (leaseHeld) => {
      await work.promise
      return leaseHeld() ? "ok" : "lost"
    })
    mockUpdateMany.mockRejectedValueOnce(new Error("connection reset"))
    mockFindUnique.mockResolvedValueOnce({ key: "k", value: "running:2026-10:999" })
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    const calls = mockUpdateMany.mock.calls.length
    await jest.advanceTimersByTimeAsync(LEASE_MS)
    expect(mockUpdateMany.mock.calls.length).toBe(calls) // heartbeat stopped
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("lease lost"))
    work.resolve()
    await expect(run).resolves.toBe("locked")
  })

  it("returns 'locked' when loss is found after the work's last leaseHeld() check", async () => {
    const work = deferred()
    const run = runOncePerPeriodLocked(opts(), async () => {
      await work.promise
      return "ok"
    })
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })
    await jest.advanceTimersByTimeAsync(LEASE_MS / 3)
    work.resolve()
    await expect(run).resolves.toBe("locked")
    expect(mockUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { value: "2026-10" } }))
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })
})
