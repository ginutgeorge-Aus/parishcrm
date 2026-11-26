import { isSlugArg, mintRegistrationToken, REGISTRATION_TOKEN_RE, registrationLinkWhere } from "@/lib/registrationLink"

describe("registrationLinkWhere", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-06-30T00:00:00.000Z"))
  })
  afterEach(() => jest.useRealTimers())

  it("scopes to token + event and expires 30 days back from now", () => {
    const where = registrationLinkWhere("REG-ABCDEF123456", 7)
    const floor = new Date("2026-05-31T00:00:00.000Z")
    expect(where.publicToken).toBe("REG-ABCDEF123456")
    expect(where.eventId).toBe(7)
    expect(where.OR?.[0]).toEqual({ createdAt: { gte: floor } })
  })

  it("re-arms the link when a successful staff reminder was sent inside the window", () => {
    const floor = new Date("2026-05-31T00:00:00.000Z")
    const where = registrationLinkWhere("REG-ABCDEF123456", 7)
    expect(where.OR?.[1]).toEqual({ paymentReminders: { some: { status: "SUCCESS", sentAt: { gte: floor } } } })
  })

  it("moves the floor as the clock advances", () => {
    jest.setSystemTime(new Date("2026-07-30T00:00:00.000Z"))
    const where = registrationLinkWhere("REG-ABCDEF123456", 7)
    expect(where.OR?.[0]).toEqual({ createdAt: { gte: new Date("2026-06-30T00:00:00.000Z") } })
  })
})

describe("isSlugArg", () => {
  it("accepts strings only", () => {
    expect(isSlugArg("spring-fair")).toBe(true)
    expect(isSlugArg({ not: "" })).toBe(false)
    expect(isSlugArg(undefined)).toBe(false)
  })
})

describe("mintRegistrationToken", () => {
  it("mints tokens that match REGISTRATION_TOKEN_RE", () => {
    expect(mintRegistrationToken()).toMatch(REGISTRATION_TOKEN_RE)
  })

  it("mints distinct tokens", () => {
    expect(mintRegistrationToken()).not.toBe(mintRegistrationToken())
  })
})
