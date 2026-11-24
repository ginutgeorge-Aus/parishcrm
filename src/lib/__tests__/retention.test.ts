import { isWithinRetention, retentionFloor, retentionError } from "@/lib/retention"

const NOW = new Date("2026-11-24T00:00:00.000Z")

describe("isWithinRetention", () => {
  test("7 years less a day is inside", () => {
    expect(isWithinRetention(new Date("2019-11-25T00:00:00.000Z"), NOW)).toBe(true)
  })
  test("exactly 7 years is inside (matches the server's >= floor check)", () => {
    expect(isWithinRetention(new Date("2019-11-24T00:00:00.000Z"), NOW)).toBe(true)
  })
  test("7 years plus a day is outside", () => {
    expect(isWithinRetention(new Date("2019-11-23T00:00:00.000Z"), NOW)).toBe(false)
  })
  test("recent and future dates are inside", () => {
    expect(isWithinRetention(NOW, NOW)).toBe(true)
    expect(isWithinRetention(new Date("2027-01-01T00:00:00.000Z"), NOW)).toBe(true)
  })
  test("agrees with retentionFloor", () => {
    expect(retentionFloor(NOW).toISOString()).toBe("2019-11-24T00:00:00.000Z")
  })
})

test("retentionError names the next step", () => {
  expect(retentionError(new Date("2025-01-02T00:00:00.000Z"))).toMatch(/reversing entry/)
})
