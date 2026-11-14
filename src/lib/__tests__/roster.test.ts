import {
  findConflict, isSundayYMD, isUnavailableOn, openPlaces, RosterRoleSchema, RosterServiceSchema, serviceTimes,
  suggestAssignees, type RosterCandidate, type ServiceContext,
} from "@/lib/roster"

const ctx = (over: Partial<ServiceContext> = {}): ServiceContext => ({
  serviceYMD: "2026-12-06",
  assignedPersonIds: new Set(),
  unavailability: new Map(),
  ...over,
})

const person = (personId: number, lastName: string, firstName = "A"): RosterCandidate => ({ personId, firstName, lastName })

describe("isUnavailableOn", () => {
  const ranges = [{ startYMD: "2026-12-01", endYMD: "2026-12-06" }]
  it("includes both ends of a range", () => {
    expect(isUnavailableOn(ranges, "2026-12-01")).toBe(true)
    expect(isUnavailableOn(ranges, "2026-12-06")).toBe(true)
  })
  it("is false outside every range", () => {
    expect(isUnavailableOn(ranges, "2026-11-30")).toBe(false)
    expect(isUnavailableOn(ranges, "2026-12-07")).toBe(false)
    expect(isUnavailableOn([], "2026-12-06")).toBe(false)
  })
})

describe("findConflict", () => {
  it("returns null for a free person", () => {
    expect(findConflict(1, ctx())).toBeNull()
  })
  it("flags someone already rostered at the service", () => {
    expect(findConflict(1, ctx({ assignedPersonIds: new Set([1]) }))).toBe("ALREADY_ASSIGNED")
  })
  it("flags someone unavailable that day", () => {
    const unavailability = new Map([[1, [{ startYMD: "2026-12-06", endYMD: "2026-12-06" }]]])
    expect(findConflict(1, ctx({ unavailability }))).toBe("UNAVAILABLE")
  })
  it("ignores another person's unavailability", () => {
    const unavailability = new Map([[2, [{ startYMD: "2026-12-01", endYMD: "2026-12-31" }]]])
    expect(findConflict(1, ctx({ unavailability }))).toBeNull()
  })
  it("prefers ALREADY_ASSIGNED when both apply", () => {
    const unavailability = new Map([[1, [{ startYMD: "2026-12-01", endYMD: "2026-12-31" }]]])
    expect(findConflict(1, ctx({ assignedPersonIds: new Set([1]), unavailability }))).toBe("ALREADY_ASSIGNED")
  })
})

describe("openPlaces", () => {
  it("counts pending and confirmed as held, declined as free", () => {
    expect(openPlaces(3, ["PENDING", "CONFIRMED", "DECLINED"])).toBe(1)
  })
  it("never goes below zero", () => {
    expect(openPlaces(1, ["PENDING", "CONFIRMED"])).toBe(0)
  })
})

describe("suggestAssignees", () => {
  it("puts never-served first, then oldest last-served", () => {
    const people = [person(1, "Ash"), person(2, "Bell"), person(3, "Cole")]
    const last = new Map([[1, "2026-11-01"], [2, "2026-10-01"]])
    expect(suggestAssignees(people, last, ctx()).map((s) => s.personId)).toEqual([3, 2, 1])
  })
  it("returns lastServedYMD (null for never)", () => {
    const out = suggestAssignees([person(1, "Ash"), person(2, "Bell")], new Map([[1, "2026-11-01"]]), ctx())
    expect(out).toEqual([
      { personId: 2, firstName: "A", lastName: "Bell", lastServedYMD: null },
      { personId: 1, firstName: "A", lastName: "Ash", lastServedYMD: "2026-11-01" },
    ])
  })
  it("breaks ties by surname, first name, then id", () => {
    const people = [person(4, "Bell", "Zed"), person(3, "Bell", "Amy"), person(2, "Ash"), person(1, "Ash")]
    const last = new Map([[1, "2026-11-01"], [2, "2026-11-01"], [3, "2026-11-01"], [4, "2026-11-01"]])
    expect(suggestAssignees(people, last, ctx()).map((s) => s.personId)).toEqual([1, 2, 3, 4])
  })
  it("skips people with a conflict", () => {
    const people = [person(1, "Ash"), person(2, "Bell"), person(3, "Cole")]
    const unavailability = new Map([[2, [{ startYMD: "2026-12-06", endYMD: "2026-12-06" }]]])
    const out = suggestAssignees(people, new Map(), ctx({ assignedPersonIds: new Set([1]), unavailability }))
    expect(out.map((s) => s.personId)).toEqual([3])
  })
  it("honours the limit and de-duplicates candidates", () => {
    const people = [person(1, "Ash"), person(1, "Ash"), person(2, "Bell"), person(3, "Cole")]
    expect(suggestAssignees(people, new Map(), ctx(), 2).map((s) => s.personId)).toEqual([1, 2])
    expect(suggestAssignees(people, new Map(), ctx(), 0)).toEqual([])
  })
  it("returns an empty list when nobody is eligible", () => {
    expect(suggestAssignees([], new Map(), ctx())).toEqual([])
  })
})

describe("serviceTimes", () => {
  it("converts Sydney wall clock to UTC (AEDT, +11) and anchors the date at UTC midnight", () => {
    const t = serviceTimes("2026-12-06", "09:30", "11:00")
    expect(t).toEqual({
      date: new Date("2026-12-06T00:00:00.000Z"),
      startsAt: new Date("2026-12-05T22:30:00.000Z"),
      endsAt: new Date("2026-12-06T00:00:00.000Z"),
    })
  })
  it("uses AEST (+10) in winter", () => {
    const t = serviceTimes("2026-07-05", "09:30", "11:00")
    expect("startsAt" in t && t.startsAt.toISOString()).toBe("2026-07-04T23:30:00.000Z")
  })
  it("rejects an end at or before the start", () => {
    expect(serviceTimes("2026-12-06", "11:00", "11:00")).toEqual({ error: "End time must be after the start time" })
  })
  it("rejects an impossible date", () => {
    expect(serviceTimes("2026-02-30", "09:00", "10:00")).toEqual({ error: "Enter a valid date and time" })
  })
})

describe("isSundayYMD", () => {
  it("knows Sundays", () => {
    expect(isSundayYMD("2026-12-06")).toBe(true)
    expect(isSundayYMD("2026-12-07")).toBe(false)
  })
})

describe("schemas", () => {
  it("RosterRoleSchema defaults the head count to 1 and bounds it", () => {
    expect(RosterRoleSchema.parse({ name: " Reader ", groupId: "4" })).toEqual({ name: "Reader", groupId: 4, defaultCount: 1 })
    expect(RosterRoleSchema.safeParse({ name: "Reader", groupId: "4", defaultCount: "0" }).success).toBe(false)
    expect(RosterRoleSchema.safeParse({ name: "Reader", groupId: "x" }).success).toBe(false)
  })
  it("RosterServiceSchema rejects bad kinds and times", () => {
    const ok = { kind: "ADHOC", title: "Christmas", date: "2026-12-25", startTime: "23:00", endTime: "23:30" }
    expect(RosterServiceSchema.safeParse(ok).success).toBe(true)
    expect(RosterServiceSchema.safeParse({ ...ok, kind: "WEEKLY" }).success).toBe(false)
    expect(RosterServiceSchema.safeParse({ ...ok, startTime: "24:00" }).success).toBe(false)
  })
})
