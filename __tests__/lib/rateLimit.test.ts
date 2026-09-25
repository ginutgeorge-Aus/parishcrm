import { rateLimit, __resetRateLimit } from "@/lib/rateLimit"

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimit())

  it("allows requests up to the limit within the window", () => {
    const t = 1_000_000
    expect(rateLimit("user:1", 3, 60_000, t)).toBe(true)
    expect(rateLimit("user:1", 3, 60_000, t)).toBe(true)
    expect(rateLimit("user:1", 3, 60_000, t)).toBe(true)
  })

  it("blocks the request that exceeds the limit", () => {
    const t = 1_000_000
    rateLimit("user:1", 2, 60_000, t)
    rateLimit("user:1", 2, 60_000, t)
    expect(rateLimit("user:1", 2, 60_000, t)).toBe(false)
  })

  it("resets after the window elapses", () => {
    const t = 1_000_000
    rateLimit("user:1", 1, 60_000, t)
    expect(rateLimit("user:1", 1, 60_000, t)).toBe(false)
    expect(rateLimit("user:1", 1, 60_000, t + 60_001)).toBe(true)
  })

  it("tracks keys independently", () => {
    const t = 1_000_000
    rateLimit("user:1", 1, 60_000, t)
    expect(rateLimit("user:1", 1, 60_000, t)).toBe(false)
    expect(rateLimit("user:2", 1, 60_000, t)).toBe(true)
  })
})
