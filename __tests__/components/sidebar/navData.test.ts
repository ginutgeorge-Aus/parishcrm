import { buildNavGroups, flattenNavItems } from "@/components/layout/sidebar/navData"

const allTrueFlags = {
  isAccounting: true,
  isAccountingViewer: true,
  isAdmin: true,
  isEditor: true,
  canUsers: true,
  canViewPeople: true,
  pendingUpdates: 0,
  verifyPending: 0,
  membershipPending: 0,
}

it("nests Accounting items under Transactions/Reports/Admin sub-headers", () => {
  const groups = buildNavGroups(allTrueFlags)
  const accounting = groups.find((g) => g.label === "Accounting")!
  const subLabels = accounting.items.map((entry) => ("subLabel" in entry ? entry.subLabel : entry.label))
  expect(subLabels).toEqual(["Transactions", "Reports", "Admin"])
})

it("flattenNavItems expands sub-header groups into a flat item list", () => {
  const groups = buildNavGroups(allTrueFlags)
  const accounting = groups.find((g) => g.label === "Accounting")!
  const flat = flattenNavItems(accounting.items)
  expect(flat.map((i) => i.label)).toContain("Overview")
  expect(flat.map((i) => i.label)).toContain("Acct. Settings")
  expect(flat).toHaveLength(19)
})

it("hides admin-only Accounting items when isAdmin is false", () => {
  const groups = buildNavGroups({ ...allTrueFlags, isAdmin: false })
  const accounting = groups.find((g) => g.label === "Accounting")!
  const visible = flattenNavItems(accounting.items).filter((i) => i.show)
  expect(visible.map((i) => i.label)).not.toContain("Budget")
  expect(visible.map((i) => i.label)).not.toContain("Acct. Settings")
})

it("shows Giving Summary to read-only accounting viewers (AUDITOR/OFFICE_ADMIN), not just mutation-capable roles", () => {
  const groups = buildNavGroups({ ...allTrueFlags, isAccounting: false, isAccountingViewer: true })
  const accounting = groups.find((g) => g.label === "Accounting")!
  const visible = flattenNavItems(accounting.items).filter((i) => i.show)
  expect(visible.map((i) => i.label)).toContain("Giving Summary")
})

it("hides Families/People/Birthdays/Events from a role that can't view people (AUDITOR)", () => {
  const groups = buildNavGroups({ ...allTrueFlags, canViewPeople: false })
  const members = groups.find((g) => g.label === "Members")!
  const events = groups.find((g) => g.label === "Events")!
  const visibleMembers = flattenNavItems(members.items).filter((i) => i.show).map((i) => i.label)
  const visibleEvents = flattenNavItems(events.items).filter((i) => i.show).map((i) => i.label)
  expect(visibleMembers).not.toContain("Families")
  expect(visibleMembers).not.toContain("People")
  expect(visibleMembers).not.toContain("Birthdays")
  expect(visibleEvents).not.toContain("Events")
  // Dashboard has no role restriction — stays visible for every authenticated role.
  expect(visibleMembers).toContain("Dashboard")
})

it("keeps Members/Events/Settings groups as flat NavItem arrays", () => {
  const groups = buildNavGroups(allTrueFlags)
  for (const label of ["Members", "Events", "Settings"]) {
    const group = groups.find((g) => g.label === label)!
    expect(group.items.every((entry) => !("subLabel" in entry))).toBe(true)
  }
})
