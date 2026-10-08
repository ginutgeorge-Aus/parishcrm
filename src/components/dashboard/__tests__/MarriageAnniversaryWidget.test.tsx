/** @jest-environment node */
import { elapsedYears } from "@/components/dashboard/MarriageAnniversaryWidget"

describe("elapsedYears", () => {
  const married = new Date("2000-03-15T00:00:00.000Z")
  afterEach(() => jest.useRealTimers())

  it("counts the anniversary on the Sydney day while UTC is still the day before", () => {
    // 2026-03-14T22:00Z = 09:00 on 15 Mar in Sydney (AEDT +11).
    expect(elapsedYears(married, new Date("2026-03-14T22:00:00.000Z"))).toBe(26)
  })

  it("is one less on the Sydney day before the anniversary", () => {
    // 2026-03-14T12:00Z = 23:00 on 14 Mar in Sydney.
    expect(elapsedYears(married, new Date("2026-03-14T12:00:00.000Z"))).toBe(25)
  })

  it("observes a 29 Feb marriage on 28 Feb in a non-leap year", () => {
    const leap = new Date("2000-02-29T00:00:00.000Z")
    // 2026-02-28T02:00Z = 13:00 on 28 Feb in Sydney.
    expect(elapsedYears(leap, new Date("2026-02-28T02:00:00.000Z"))).toBe(26)
    // 2026-02-27T02:00Z = 13:00 on 27 Feb in Sydney.
    expect(elapsedYears(leap, new Date("2026-02-27T02:00:00.000Z"))).toBe(25)
  })

  it("defaults to the current instant, read on the Sydney clock", () => {
    jest.useFakeTimers({ now: new Date("2026-03-14T22:00:00.000Z") })
    expect(elapsedYears(married)).toBe(26)
  })
})
