// src/lib/__tests__/usageFeatures.test.ts
import { TRACKED_FEATURE_AREAS, dormantAreas, weekBuckets } from "@/lib/usageFeatures"

describe("usageFeatures", () => {
  it("dormantAreas returns canonical areas not seen, in canonical order", () => {
    const seen = [TRACKED_FEATURE_AREAS[1]]
    const result = dormantAreas(seen)
    expect(result).not.toContain(TRACKED_FEATURE_AREAS[1])
    expect(result).toContain(TRACKED_FEATURE_AREAS[0])
    // order preserved
    expect(result).toEqual(TRACKED_FEATURE_AREAS.filter((a) => a !== TRACKED_FEATURE_AREAS[1]))
  })

  it("weekBuckets returns `weeks` contiguous 7-day windows oldest-first ending at now", () => {
    const now = new Date("2026-09-01T00:00:00.000Z")
    const b = weekBuckets(now, 3)
    expect(b).toHaveLength(3)
    expect(b[2].end.getTime()).toBe(now.getTime())
    expect(b[0].start.getTime()).toBe(now.getTime() - 21 * 86400_000)
    expect(b[1].start.getTime()).toBe(b[0].end.getTime())
  })
})
