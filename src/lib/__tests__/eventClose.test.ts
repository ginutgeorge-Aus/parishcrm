import { isRegistrationClosed } from "@/lib/eventClose"

const base = { registrationClosed: false, registrationDeadline: null as Date | null }
const NOW = new Date("2026-08-17T00:00:00Z")

describe("isRegistrationClosed", () => {
  it("open when flag false and no deadline", () => {
    expect(isRegistrationClosed(base, NOW)).toBe(false)
  })
  it("closed when manual flag set", () => {
    expect(isRegistrationClosed({ ...base, registrationClosed: true }, NOW)).toBe(true)
  })
  it("closed when deadline has passed", () => {
    expect(isRegistrationClosed({ ...base, registrationDeadline: new Date("2026-08-16T23:59:00Z") }, NOW)).toBe(true)
  })
  it("open when deadline is in the future", () => {
    expect(isRegistrationClosed({ ...base, registrationDeadline: new Date("2026-08-18T00:00:00Z") }, NOW)).toBe(false)
  })
  it("open exactly at the deadline instant (strictly-after closes)", () => {
    expect(isRegistrationClosed({ ...base, registrationDeadline: NOW }, NOW)).toBe(false)
  })
})
