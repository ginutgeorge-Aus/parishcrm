import { upcomingBirthdays, BIRTHDAY_WINDOWS, type BirthdayPerson } from "@/lib/birthdays"

const mk = (id: number, dob: string, over: Partial<BirthdayPerson> = {}): BirthdayPerson => ({
  id,
  firstName: `F${id}`,
  lastName: `L${id}`,
  dateOfBirth: new Date(dob),
  email: `p${id}@example.com`,
  emailConsent: true,
  family: { name: `Fam${id}` },
  ...over,
})

describe("upcomingBirthdays", () => {
  const today = new Date("2026-06-01T00:00:00")

  it("exposes the window options", () => {
    expect(BIRTHDAY_WINDOWS).toEqual([7, 14, 30])
  })

  it("includes a birthday inside the window and computes age turning", () => {
    const people = [mk(1, "1990-06-05")] // turns 36 on 5 Jun 2026
    const result = upcomingBirthdays(people, 7, today)
    expect(result).toHaveLength(1)
    expect(result[0].ageTurning).toBe(36)
    expect(result[0].daysUntil).toBe(4)
  })

  it("excludes a birthday outside the window", () => {
    const people = [mk(1, "1990-07-15")]
    expect(upcomingBirthdays(people, 7, today)).toHaveLength(0)
  })

  it("includes today's birthday with daysUntil 0", () => {
    const people = [mk(1, "1980-06-01")]
    const result = upcomingBirthdays(people, 7, today)
    expect(result[0].daysUntil).toBe(0)
    expect(result[0].ageTurning).toBe(46)
  })

  it("handles year-end wrap (Dec window into Jan)", () => {
    const dec = new Date("2026-12-28T00:00:00")
    const people = [mk(1, "1990-01-02"), mk(2, "1990-12-30")]
    const result = upcomingBirthdays(people, 7, dec)
    expect(result.map((r) => r.id).sort()).toEqual([1, 2])
  })

  it("sorts by daysUntil ascending", () => {
    const people = [mk(1, "1990-06-10"), mk(2, "1990-06-03"), mk(3, "1990-06-07")]
    const result = upcomingBirthdays(people, 14, today)
    expect(result.map((r) => r.id)).toEqual([2, 3, 1])
  })

  it("handles a 29 Feb birthday in a non-leap year without crashing", () => {
    const feb = new Date("2026-02-25T00:00:00") // 2026 is not a leap year
    const people = [mk(1, "2000-02-29")]
    const result = upcomingBirthdays(people, 7, feb)
    expect(result).toHaveLength(1)
    expect(result[0].ageTurning).toBe(26)
  })

  it("returns empty for empty input", () => {
    expect(upcomingBirthdays([], 30, today)).toEqual([])
  })

  describe("29 Feb birthday observed on 28 Feb in a non-leap year", () => {
    it("treats the birthday as 28 Feb, not 1 Mar, so daysUntil isn't shifted a day late", () => {
      const feb = new Date("2026-02-25T00:00:00") // 2026 is not a leap year
      const people = [mk(1, "2000-02-29")]
      const result = upcomingBirthdays(people, 7, feb)
      expect(result).toHaveLength(1)
      // Without the fix this rolls to 1 Mar (daysUntil 4) instead of 28 Feb (daysUntil 3).
      expect(result[0].daysUntil).toBe(3)
    })

    it("is included with daysUntil 0 when today is exactly the observed 28 Feb", () => {
      const feb28 = new Date("2026-02-28T00:00:00") // 2026 is not a leap year
      const people = [mk(1, "2000-02-29")]
      const result = upcomingBirthdays(people, 0, feb28)
      expect(result).toHaveLength(1)
      expect(result[0].daysUntil).toBe(0)
    })

    it("still lands on the real 29 Feb in a leap year", () => {
      const feb = new Date("2024-02-20T00:00:00") // 2024 is a leap year
      const people = [mk(1, "2000-02-29")]
      const result = upcomingBirthdays(people, 14, feb)
      expect(result).toHaveLength(1)
      expect(result[0].daysUntil).toBe(9) // 20 Feb -> 29 Feb
    })
  })

  describe("on a west-of-UTC host", () => {
    // `today` is always a UTC-midnight instant in production (the storage/caller
    // convention — see sydneyToday() in lib/dates.ts), but the process' local
    // timezone can differ from UTC in dev or on some hosts. On a west-of-UTC
    // host, a UTC-midnight instant's *local* wall-clock date is the previous
    // calendar day. Simulate that directly on the `today` instance (rather than
    // via process.env.TZ, which Jest's Node environment does not re-read after
    // startup) to prove the window is computed from the UTC calendar day, not
    // whatever the local getters happen to report.
    function utcMidnightAsSeenFromWestOfUtc(iso: string): Date {
      const d = new Date(iso)
      const prevDay = new Date(d.getTime() - 1)
      Object.defineProperty(d, "getFullYear", { value: () => prevDay.getUTCFullYear() })
      Object.defineProperty(d, "getMonth", { value: () => prevDay.getUTCMonth() })
      Object.defineProperty(d, "getDate", { value: () => prevDay.getUTCDate() })
      return d
    }

    it("still finds today's birthday with daysUntil 0 for a UTC-midnight `today`", () => {
      const utcToday = utcMidnightAsSeenFromWestOfUtc("2026-06-01T00:00:00.000Z")
      const people = [mk(1, "1980-06-01")]
      const result = upcomingBirthdays(people, 7, utcToday)
      expect(result).toHaveLength(1)
      expect(result[0].daysUntil).toBe(0)
    })

    it("does not shift the window a day early", () => {
      // A birthday exactly `windowDays` out from the true UTC calendar day.
      const utcToday = utcMidnightAsSeenFromWestOfUtc("2026-06-01T00:00:00.000Z")
      const people = [mk(1, "1990-06-08")] // 7 days after 1 Jun
      const result = upcomingBirthdays(people, 7, utcToday)
      expect(result).toHaveLength(1)
      expect(result[0].daysUntil).toBe(7)
    })
  })
})
