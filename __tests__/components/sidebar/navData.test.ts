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

it("puts Dashboard/People/Families/Events in a headless top-level group", () => {
  const [main, ...rest] = buildNavGroups(allTrueFlags)
  expect(main.headless).toBe(true)
  expect(flattenNavItems(main.items).map((i) => i.label)).toEqual(["Dashboard", "People", "Families", "Events"])
  expect(rest.map((g) => g.label)).toEqual(["Community", "Accounting", "Settings"])
  expect(rest.every((g) => !g.headless)).toBe(true)
})

it("nests Accounting items under Books/Billing & Receipts/Admin sub-headers", () => {
  const groups = buildNavGroups(allTrueFlags)
  const accounting = groups.find((g) => g.label === "Accounting")!
  const subLabels = accounting.items.map((entry) => ("subLabel" in entry ? entry.subLabel : entry.label))
  expect(subLabels).toEqual(["Books", "Billing & Receipts", "Admin"])
})

it("links the reports hub instead of each individual report", () => {
  const accounting = buildNavGroups(allTrueFlags).find((g) => g.label === "Accounting")!
  const hrefs = flattenNavItems(accounting.items).map((i) => i.href)
  expect(hrefs).toContain("/accounting/reports")
  expect(hrefs.filter((h) => h.startsWith("/accounting/reports/"))).toEqual([])
  expect(hrefs).toHaveLength(14)
})

it("gives every link a unique icon and a unique href", () => {
  const all = buildNavGroups(allTrueFlags).flatMap((g) => flattenNavItems(g.items))
  expect(new Set(all.map((i) => i.icon)).size).toBe(all.length)
  expect(new Set(all.map((i) => i.href)).size).toBe(all.length)
})

it("hides admin-only Accounting items when isAdmin is false", () => {
  const groups = buildNavGroups({ ...allTrueFlags, isAdmin: false })
  const accounting = groups.find((g) => g.label === "Accounting")!
  const visible = flattenNavItems(accounting.items).filter((i) => i.show)
  expect(visible.map((i) => i.label)).not.toContain("Budget")
  expect(visible.map((i) => i.label)).not.toContain("Accounting Settings")
})

it("shows the Reports hub to read-only accounting viewers (AUDITOR/OFFICE_ADMIN), not just mutation-capable roles", () => {
  const groups = buildNavGroups({ ...allTrueFlags, isAccounting: false, isAccountingViewer: true })
  const accounting = groups.find((g) => g.label === "Accounting")!
  const visible = flattenNavItems(accounting.items).filter((i) => i.show)
  expect(visible.map((i) => i.label)).toContain("Reports")
  expect(visible.map((i) => i.label)).not.toContain("Bank Import")
})

it("hides Families/People/Birthdays/Events from a role that can't view people (AUDITOR)", () => {
  const groups = buildNavGroups({ ...allTrueFlags, canViewPeople: false })
  const visible = groups.flatMap((g) => flattenNavItems(g.items)).filter((i) => i.show).map((i) => i.label)
  expect(visible).not.toContain("Families")
  expect(visible).not.toContain("People")
  expect(visible).not.toContain("Birthdays")
  expect(visible).not.toContain("Events")
  // Dashboard has no role restriction — stays visible for every authenticated role.
  expect(visible).toContain("Dashboard")
})

it("keeps Main/Community/Settings groups as flat NavItem arrays", () => {
  const groups = buildNavGroups(allTrueFlags)
  for (const label of ["Main", "Community", "Settings"]) {
    const group = groups.find((g) => g.label === label)!
    expect(group.items.every((entry) => !("subLabel" in entry))).toBe(true)
  }
})

it("shows the Clearances link only to editors (canManageClearances = canEdit)", () => {
  const visible = (flags: typeof allTrueFlags) =>
    flattenNavItems(buildNavGroups(flags).find((g) => g.label === "Community")!.items)
      .filter((i) => i.show).map((i) => i.label)
  expect(visible(allTrueFlags)).toContain("Clearances")
  expect(visible({ ...allTrueFlags, isEditor: false })).not.toContain("Clearances")
})

it("shows Sunday School in Community only to roles that can view people", () => {
  const find = (canViewPeople: boolean) =>
    flattenNavItems(buildNavGroups({ ...allTrueFlags, canViewPeople }).find((g) => g.label === "Community")!.items)
      .find((i) => i.href === "/sunday-school")
  expect(find(true)).toMatchObject({ label: "Sunday School", show: true })
  expect(find(false)?.show).toBe(false)
})
