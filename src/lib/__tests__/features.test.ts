/** @jest-environment node */
import { FEATURES, FEATURE_KEYS, parseOverrides, parseStoredOverrides, resolveFeatures } from "@/lib/features"

describe("features registry", () => {
  it("every parent/requires refers to a known key", () => {
    for (const f of FEATURES) {
      if (f.parent) expect(FEATURE_KEYS).toContain(f.parent)
      for (const r of f.requires ?? []) expect(FEATURE_KEYS).toContain(r)
    }
  })

  it("keys are unique", () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length)
  })

  it("all features on with no overrides", () => {
    expect(resolveFeatures({}).size).toBe(FEATURE_KEYS.length)
  })

  it("explicit false turns a feature off", () => {
    expect(resolveFeatures({ events: false }).has("events")).toBe(false)
  })

  it("parent off turns children off even when child is explicitly on", () => {
    const on = resolveFeatures({ accounting: false, budget: true })
    expect(on.has("budget")).toBe(false)
    expect(on.has("invoices")).toBe(false)
  })

  it("requires: dues off when memberships off", () => {
    expect(resolveFeatures({ memberships: false }).has("dues")).toBe(false)
  })
})

describe("parseOverrides", () => {
  it("returns {} for null, empty and corrupt JSON", () => {
    expect(parseOverrides(null)).toEqual({})
    expect(parseOverrides(undefined)).toEqual({})
    expect(parseOverrides("")).toEqual({})
    expect(parseOverrides("{not json")).toEqual({})
    expect(parseOverrides("[1,2]")).toEqual({})
    expect(parseOverrides("null")).toEqual({})
  })

  it("keeps known boolean keys, drops unknown keys and non-booleans", () => {
    expect(parseOverrides('{"events":false,"bogus":false,"budget":"no"}')).toEqual({ events: false })
  })
})

describe("parseStoredOverrides", () => {
  it("is pure: flags a corrupt value but not an empty object, however it is formatted", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      for (const raw of [null, "", "{}", "{ }", "{\n}"]) expect(parseStoredOverrides(raw)).toEqual({ overrides: {}, unreadable: false })
      expect(parseStoredOverrides("not json")).toEqual({ overrides: {}, unreadable: true })
      expect(parseStoredOverrides('{"events":false}')).toEqual({ overrides: { events: false }, unreadable: false })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
