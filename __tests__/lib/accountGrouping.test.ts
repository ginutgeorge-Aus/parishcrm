import { groupByAccountGroup } from "@/lib/reports/accountGrouping"

type Row = { id: number; group: { id: number; name: string; sortOrder: number } | null }

describe("groupByAccountGroup", () => {
  it("buckets accounts by group name, sorted by sortOrder", () => {
    const rows: Row[] = [
      { id: 1, group: { id: 2, name: "B", sortOrder: 2 } },
      { id: 2, group: { id: 1, name: "A", sortOrder: 1 } },
      { id: 3, group: { id: 2, name: "B", sortOrder: 2 } },
    ]
    const groups = groupByAccountGroup(rows)
    expect(groups.map((g) => g.groupName)).toEqual(["A", "B"])
    expect(groups[1].accounts.map((a) => a.id)).toEqual([1, 3])
  })

  it("collapses ungrouped accounts into 'Other' with sortOrder 999 (sorted last)", () => {
    const rows: Row[] = [
      { id: 1, group: null },
      { id: 2, group: { id: 1, name: "A", sortOrder: 1 } },
    ]
    const groups = groupByAccountGroup(rows)
    expect(groups.map((g) => g.groupName)).toEqual(["A", "Other"])
    expect(groups[1].sortOrder).toBe(999)
    expect(groups[1].accounts.map((a) => a.id)).toEqual([1])
  })

  it("returns an empty array for no accounts", () => {
    expect(groupByAccountGroup([])).toEqual([])
  })

  // two distinct AccountGroup rows can share a display name (the
  // unique key is (name, type), not name alone) — keying the map by name
  // merged them into one group and dropped one group's sortOrder/identity.
  it("keeps two distinct groups separate even when their names collide", () => {
    const rows: Row[] = [
      { id: 1, group: { id: 10, name: "Fundraising", sortOrder: 1 } },
      { id: 2, group: { id: 20, name: "Fundraising", sortOrder: 5 } },
    ]
    const groups = groupByAccountGroup(rows)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.accounts.map((a) => a.id))).toEqual([[1], [2]])
  })
})
