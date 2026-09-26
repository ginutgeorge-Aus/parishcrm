import { parseRouteId } from "@/lib/validation"

describe("parseRouteId", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["2147483647", 2147483647],
  ])("accepts %p → %p", (raw, expected) => {
    expect(parseRouteId(raw)).toBe(expected)
  })

  it.each([
    "", "0", "-1", "2147483648", "1.5", "12abc", "abc", " 7", "1e3", "0x10",
  ])("rejects %p", (raw) => {
    expect(parseRouteId(raw)).toBeNull()
  })

  it("rejects null/undefined", () => {
    expect(parseRouteId(null)).toBeNull()
    expect(parseRouteId(undefined)).toBeNull()
  })
})
