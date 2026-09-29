import { bearerOk, safeEqual } from "@/lib/cronAuth"

describe("bearerOk (shared cron auth)", () => {
  it("rejects an empty Bearer token when the secret is empty (no auth bypass)", () => {
    expect(bearerOk("Bearer ", "")).toBe(false)
    expect(bearerOk("", "")).toBe(false)
    expect(bearerOk(null, "")).toBe(false)
  })
  it("accepts the matching token and rejects a wrong one", () => {
    expect(bearerOk("Bearer s3cret", "s3cret")).toBe(true)
    expect(bearerOk("Bearer nope", "s3cret")).toBe(false)
    expect(bearerOk("s3cret", "s3cret")).toBe(false) // missing prefix
  })
})

describe("safeEqual", () => {
  it("fails closed on an empty secret", () => {
    expect(safeEqual("", "")).toBe(false)
    expect(safeEqual("x", "")).toBe(false)
  })
  it("matches equal strings and rejects different or different-length ones", () => {
    expect(safeEqual("s3cret", "s3cret")).toBe(true)
    expect(safeEqual("s3creT", "s3cret")).toBe(false)
    expect(safeEqual("s3cre", "s3cret")).toBe(false)
  })
})
