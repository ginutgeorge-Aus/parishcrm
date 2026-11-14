import {
  followUpStatusesFor,
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
