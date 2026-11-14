import {
  followUpStatusesFor,
  matchesAssignee,
  parseAssigneeFilter,
  parseFollowUpStatusFilter,
} from "@/lib/pastoralLabels"

describe("parseFollowUpStatusFilter", () => {
  it.each([
    ["done", "done"],
    ["all", "all"],
    ["open", "open"],
    ["bogus", "open"],
    [undefined, "open"],
  ])("%s -> %s", (raw, want) => expect(parseFollowUpStatusFilter(raw)).toBe(want))
  it("takes the first of repeated params", () => expect(parseFollowUpStatusFilter(["all", "done"])).toBe("all"))
})

describe("followUpStatusesFor", () => {
  it("maps filters to statuses", () => {
    expect(followUpStatusesFor("open")).toEqual(["OPEN", "IN_PROGRESS"])
    expect(followUpStatusesFor("done")).toEqual(["DONE", "CANCELLED"])
    expect(followUpStatusesFor("all")).toBeUndefined()
  })
})

describe("parseAssigneeFilter", () => {
  it.each([
    ["mine", "mine"],
    ["unassigned", "unassigned"],
    ["12", 12],
    ["0", "all"],
    ["-3", "all"],
    ["1.5", "all"],
    ["99999999999", "all"],
    ["x", "all"],
    [undefined, "all"],
  ])("%s -> %s", (raw, want) => expect(parseAssigneeFilter(raw)).toBe(want))
})

describe("matchesAssignee", () => {
  it("all and mine pass everything (mine is applied by the action)", () => {
    expect(matchesAssignee({ assigneeId: null }, "all")).toBe(true)
    expect(matchesAssignee({ assigneeId: 4 }, "mine")).toBe(true)
  })
  it("unassigned and by-id filter", () => {
    expect(matchesAssignee({ assigneeId: null }, "unassigned")).toBe(true)
    expect(matchesAssignee({ assigneeId: 4 }, "unassigned")).toBe(false)
    expect(matchesAssignee({ assigneeId: 4 }, 4)).toBe(true)
    expect(matchesAssignee({ assigneeId: 5 }, 4)).toBe(false)
  })
})
