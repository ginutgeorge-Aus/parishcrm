import { applyVars, DEFAULT_EMAIL_TEMPLATES, EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATE_VARS } from "@/lib/emailTemplates"

describe("applyVars", () => {
  it("substitutes known tokens", () => {
    expect(applyVars("Hello {name} of {churchName}", { name: "Jane", churchName: "Example Church" }))
      .toBe("Hello Jane of Example Church")
  })
  it("leaves unknown tokens verbatim and never throws", () => {
    expect(applyVars("Hi {name} {bogus}", { name: "Jane" })).toBe("Hi Jane {bogus}")
  })
  it("replaces every occurrence", () => {
    expect(applyVars("{x}-{x}", { x: "a" })).toBe("a-a")
  })
})

describe("defaults", () => {
  it("has fields for every key", () => {
    for (const k of EMAIL_TEMPLATE_KEYS) {
      expect(DEFAULT_EMAIL_TEMPLATES[k].subject.length).toBeGreaterThan(0)
      expect(Array.isArray(EMAIL_TEMPLATE_VARS[k])).toBe(true)
    }
  })
})
