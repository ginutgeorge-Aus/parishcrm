import { extractRegToken } from "@/lib/eventCheckin"

describe("extractRegToken", () => {
  it("returns a raw token unchanged", () => {
    expect(extractRegToken("REG-DEADBEEF1234")).toBe("REG-DEADBEEF1234")
  })

  it("uppercases a lowercase token", () => {
    expect(extractRegToken("reg-deadbeef1234")).toBe("REG-DEADBEEF1234")
  })

  it("pulls the token out of a URL", () => {
    expect(extractRegToken("https://app.example.org/e/gala/success?ref=REG-ABC123")).toBe("REG-ABC123")
  })

  it("trims surrounding whitespace", () => {
    expect(extractRegToken("  REG-ABC123  ")).toBe("REG-ABC123")
  })

  it("returns null for input without a token", () => {
    expect(extractRegToken("hello world")).toBeNull()
    expect(extractRegToken("")).toBeNull()
  })
})
