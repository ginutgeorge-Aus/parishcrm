import { WHATS_NEW, findEntry } from "@/lib/whatsNew"

describe("whatsNew", () => {
  it("WHATS_NEW is non-empty and newest-first", () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0)
    // Ordering, not a hardcoded latest version (which breaks every release):
    // dates must be non-increasing down the list (newest first).
    const dates = WHATS_NEW.map((e) => e.date)
    const sorted = [...dates].sort().reverse()
    expect(dates).toEqual(sorted)
  })

  it("each entry has a version, date, and at least one highlight", () => {
    for (const e of WHATS_NEW) {
      expect(e.version).toMatch(/^v\d+\.\d+\.\d+$/)
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(e.highlights.length).toBeGreaterThan(0)
    }
  })

  it("findEntry returns the matching entry", () => {
    expect(findEntry("v1.10.0")?.version).toBe("v1.10.0")
  })

  it("findEntry returns undefined for unknown version, 'dev', and undefined", () => {
    expect(findEntry("v0.0.0")).toBeUndefined()
    expect(findEntry("dev")).toBeUndefined()
    expect(findEntry(undefined)).toBeUndefined()
  })
})
