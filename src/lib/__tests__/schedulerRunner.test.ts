/** @jest-environment node */
import { initialState } from "@/lib/scheduler"
import { tick, startScheduler, FIRST_TICK_MS, TICK_MS, type Jobs } from "@/lib/schedulerRunner"

const NOW = new Date("2026-07-01T17:00:00Z") // Thu 03:00 AEST — only reminders/checkouts due

function jobs(overrides: Partial<Jobs> = {}): Jobs {
  return {
    reminders: jest.fn(async () => ({ eventsReminded: 0 })),
    checkouts: jest.fn(async () => ({ expired: 0 })),
    celebrations: jest.fn(async () => ({})),
    errorDigest: jest.fn(async () => ({})),
    clearanceDigest: jest.fn(async () => ({})),
    ...overrides,
  }
}

const OLD_CLEARANCE_DIGEST = process.env.CLEARANCE_DIGEST
beforeEach(() => {
  process.env.CLEARANCE_DIGEST = "true" // the clearance digest is opt-in
  jest.spyOn(console, "log").mockImplementation(() => {})
  jest.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  if (OLD_CLEARANCE_DIGEST === undefined) delete process.env.CLEARANCE_DIGEST
  else process.env.CLEARANCE_DIGEST = OLD_CLEARANCE_DIGEST
  jest.restoreAllMocks()
})

describe("tick", () => {
  it("runs the monthly clearance digest on the 1st and records the month as its success key", async () => {
    const s = initialState(); const j = jobs()
    const first = new Date("2026-06-30T21:00:00Z") // Wed 2026-07-01 07:00 AEST
    await tick(s, j, first)
    expect(j.clearanceDigest).toHaveBeenCalledWith(first)
    expect(s.clearanceDigest.lastSuccessKey).toBe("2026-07")
    await tick(s, j, new Date("2026-06-30T22:00:00Z"))
    expect(j.clearanceDigest).toHaveBeenCalledTimes(1)
  })

  it("keeps the digest open when sends failed (failed > 0), so a later tick retries it", async () => {
    const s = initialState()
    const j = jobs({ clearanceDigest: jest.fn(async () => ({ flagged: 3, sent: 0, failed: 2 })) })
    await tick(s, j, new Date("2026-06-30T21:00:00Z"))
    expect(s.clearanceDigest.lastSuccessKey).toBeNull()
  })

  it("runs due jobs and records their start", async () => {
    const s = initialState(); const j = jobs()
    await tick(s, j, NOW)
    expect(j.reminders).toHaveBeenCalledWith(NOW)
    expect(j.checkouts).toHaveBeenCalled()
    expect(j.celebrations).not.toHaveBeenCalled()
    expect(s.reminders.lastStart).toBe(NOW.getTime())
    expect(s.reminders.running).toBe(false)
  })

  it("isolates a throwing job and logs it without stopping the others", async () => {
    const s = initialState()
    const j = jobs({ reminders: jest.fn(async () => { throw new Error("db down") }) })
    await tick(s, j, NOW)
    expect(j.checkouts).toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"job":"reminders"'))
    expect(s.reminders.running).toBe(false)
  })

  it("records the success day so a daily job is not repeated", async () => {
    const s = initialState(); const j = jobs()
    const seven = new Date("2026-07-01T21:00:00Z") // 07:00 AEST
    await tick(s, j, seven)
    expect(s.celebrations.lastSuccessKey).toBe("2026-07-02")
    await tick(s, j, new Date("2026-07-01T22:00:00Z"))
    expect(j.celebrations).toHaveBeenCalledTimes(1)
  })

  it("does not record success for a failed daily job, so a later tick retries it", async () => {
    const s = initialState()
    const j = jobs({ celebrations: jest.fn(async () => { throw new Error("smtp") }) })
    await tick(s, j, new Date("2026-07-01T21:00:00Z"))
    expect(s.celebrations.lastSuccessKey).toBeNull()
  })

  it("treats a run that reports failed sends as unsuccessful, so they are retried", async () => {
    const s = initialState()
    const j = jobs({ celebrations: jest.fn(async () => ({ birthdays: { sent: 3, failed: 2 }, anniversaries: { sent: 0, failed: 0 } })) })
    await tick(s, j, new Date("2026-07-01T21:00:00Z"))
    expect(s.celebrations.lastSuccessKey).toBeNull()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"job":"celebrations"'))
  })

  it("treats a run with sends still in flight elsewhere as unsuccessful, so it is retried", async () => {
    const s = initialState()
    const j = jobs({ celebrations: jest.fn(async () => ({ birthdays: { sent: 0, skipped: 0, failed: 0, inFlight: 1 } })) })
    await tick(s, j, new Date("2026-07-01T21:00:00Z"))
    expect(s.celebrations.lastSuccessKey).toBeNull()
  })

  it("never rejects, even if scheduling itself throws", async () => {
    const s = initialState()
    const j = jobs()
    await expect(tick(s, j, new Date(NaN))).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"source":"scheduler"'))
  })

  it("a hung job does not block the other due jobs", async () => {
    const s = initialState()
    const j = jobs({ reminders: jest.fn(() => new Promise<never>(() => {})) })
    void tick(s, j, NOW)
    await Promise.resolve(); await Promise.resolve()
    expect(j.checkouts).toHaveBeenCalled()
    expect(s.checkouts.running).toBe(false)
  })

  it("never starts a job twice when ticks overlap", async () => {
    const s = initialState()
    let release!: () => void
    const slow = jest.fn(() => new Promise<void>((r) => { release = r }))
    const j = jobs({ reminders: slow })
    const first = tick(s, j, NOW)
    await tick(s, j, NOW)
    expect(slow).toHaveBeenCalledTimes(1)
    release(); await first
  })

  it("logs counts only", async () => {
    const s = initialState()
    const j = jobs({ reminders: jest.fn(async () => ({ eventsReminded: 2, note: "Alice" })) })
    await tick(s, j, NOW)
    const line = (console.log as jest.Mock).mock.calls.map((c) => c[0]).find((l: string) => l.includes('"job":"reminders"'))
    expect(line).toContain('"eventsReminded":2')
    expect(line).not.toContain("Alice")
  })
})

describe("startScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    delete (globalThis as Record<string, unknown>).__parishcrmScheduler
  })
  afterEach(() => jest.useRealTimers())

  it("first ticks after 60 s, then every 5 min, and starts only once per process", async () => {
    const j = jobs()
    expect(startScheduler(j)).toBe(true)
    expect(startScheduler(j)).toBe(false)
    await jest.advanceTimersByTimeAsync(FIRST_TICK_MS - 1)
    expect(j.reminders).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(j.reminders).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(TICK_MS * 6) // 30 min later → due again
    expect(j.reminders).toHaveBeenCalledTimes(2)
  })
})
