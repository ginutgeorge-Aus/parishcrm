import { redactPagePath } from "@/lib/redactPagePath"

describe("redactPagePath", () => {
  it.each([
    ["/venue/abc_DEF-123", "/venue/[token]"],
    ["/venue/abc_DEF-123/", "/venue/[token]/"],
    ["/family/update/s3cr3tTok", "/family/update/[token]"],
    ["/e/carols/crew/s3cr3tTok", "/e/carols/crew/[token]"],
    ["/venue/abc?x=1", "/venue/[token]?x=1"],
  ])("redacts %s", (input, expected) => {
    expect(redactPagePath(input)).toBe(expected)
  })

  it.each(["/e/carols", "/e/carols/success", "/membershipform", "/privacy", "/", "/venue", "/family/update"])(
    "leaves %s unchanged",
    (p) => {
      expect(redactPagePath(p)).toBe(p)
    },
  )

  it("passes through undefined", () => {
    expect(redactPagePath(undefined)).toBeUndefined()
  })
})
