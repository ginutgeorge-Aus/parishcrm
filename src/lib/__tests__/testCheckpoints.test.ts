import { TEST_CHECKPOINTS, findCheckpoint } from "@/lib/testCheckpoints"

describe("TEST_CHECKPOINTS", () => {
  it("has at least one checkpoint", () => {
    expect(TEST_CHECKPOINTS.length).toBeGreaterThan(0)
  })

  it("has unique ids (the never-reuse invariant)", () => {
    const ids = TEST_CHECKPOINTS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("every checkpoint has non-empty version, area, title, steps", () => {
    for (const c of TEST_CHECKPOINTS) {
      expect(c.version).toMatch(/^v\d+\.\d+\.\d+$/)
      expect(c.area.trim().length).toBeGreaterThan(0)
      expect(c.title.trim().length).toBeGreaterThan(0)
      expect(c.steps.trim().length).toBeGreaterThan(0)
    }
  })

  it("findCheckpoint returns the entry by id, undefined otherwise", () => {
    const first = TEST_CHECKPOINTS[0]
    expect(findCheckpoint(first.id)).toEqual(first)
    expect(findCheckpoint("does-not-exist")).toBeUndefined()
  })
})
