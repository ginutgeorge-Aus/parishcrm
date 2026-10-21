import { attentionItems, buildNavGroups, featureOn, flattenNavItems, navFlagsFor, pendingTotal, type NavFlags } from "@/components/layout/sidebar/navData"
import { resolveFeatures } from "@/lib/features"

/** Items of the named group, failing loudly if the group is missing. */
function groupItems(flags: NavFlags, label: string) {
  const group = buildNavGroups(flags).find((g) => g.label === label)
  if (!group) throw new Error(`no "${label}" nav group`)
  return group.items
}

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
  const subLabels = groupItems(allTrueFlags, "Accounting").map((entry) => ("subLabel" in entry ? entry.subLabel : entry.label))
  expect(subLabels).toEqual(["Books", "Billing & Receipts", "Admin"])
})

it("links the reports hub instead of each individual report", () => {
  const hrefs = flattenNavItems(groupItems(allTrueFlags, "Accounting")).map((i) => i.href)
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
  const visible = flattenNavItems(groupItems({ ...allTrueFlags, isAdmin: false }, "Accounting")).filter((i) => i.show)
  expect(visible.map((i) => i.label)).not.toContain("Budget")
  expect(visible.map((i) => i.label)).not.toContain("Accounting Settings")
})

it("shows the Reports hub to read-only accounting viewers (AUDITOR/OFFICE_ADMIN), not just mutation-capable roles", () => {
  const visible = flattenNavItems(groupItems({ ...allTrueFlags, isAccounting: false, isAccountingViewer: true }, "Accounting")).filter((i) => i.show)
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
  for (const label of ["Main", "Community", "Settings"]) {
    expect(groupItems(allTrueFlags, label).every((entry) => !("subLabel" in entry))).toBe(true)
  }
})

it("shows the Clearances link only to editors (canManageClearances = canEdit)", () => {
  const visible = (flags: typeof allTrueFlags) =>
    flattenNavItems(groupItems(flags, "Community"))
      .filter((i) => i.show).map((i) => i.label)
  expect(visible(allTrueFlags)).toContain("Clearances")
  expect(visible({ ...allTrueFlags, isEditor: false })).not.toContain("Clearances")
})

it("shows Sunday School in Community only to roles that can view people", () => {
  const find = (canViewPeople: boolean) =>
    flattenNavItems(groupItems({ ...allTrueFlags, canViewPeople }, "Community"))
      .find((i) => i.href === "/sunday-school")
  expect(find(true)).toMatchObject({ label: "Sunday School", show: true })
  expect(find(false)?.show).toBe(false)
})

it("pendingTotal sums badges of visible links only", () => {
  const items = groupItems({ ...allTrueFlags, pendingUpdates: 2, membershipPending: 3 }, "Community")
  expect(pendingTotal(items)).toBe(5)
  expect(pendingTotal(groupItems({ ...allTrueFlags, isEditor: false, pendingUpdates: 2, membershipPending: 3 }, "Community"))).toBe(0)
})

it("pendingTotal leaves informational badges (unverified release checks) out of the Settings total", () => {
  const items = groupItems({ ...allTrueFlags, verifyPending: 7 }, "Settings")
  expect(flattenNavItems(items).find((i) => i.href === "/verify")?.badge).toBe(7)
  expect(pendingTotal(items)).toBe(0)
})

describe("feature toggles", () => {
  const visible = (overrides: Parameters<typeof resolveFeatures>[0]) =>
    buildNavGroups({ ...allTrueFlags, features: resolveFeatures(overrides) })
      .flatMap((g) => flattenNavItems(g.items))
      .filter((i) => i.show)
      .map((i) => i.href)

  it("all on shows everything plus the Features link", () => {
    const hrefs = visible({})
    expect(hrefs).toContain("/events")
    expect(hrefs).toContain("/accounting/budget")
    expect(hrefs).toContain("/settings/features")
  })

  it("hides events and budget when off", () => {
    const hrefs = visible({ events: false, budget: false })
    expect(hrefs).not.toContain("/events")
    expect(hrefs).not.toContain("/accounting/budget")
    expect(hrefs).toContain("/accounting/transactions")
  })

  it("accounting off hides the whole group", () => {
    expect(visible({ accounting: false }).some((h) => h.startsWith("/accounting"))).toBe(false)
  })

  it("community features hide their own links", () => {
    const hrefs = visible({ celebrations: false, sundaySchool: false, clearances: false, familyUpdates: false, memberships: false, welcomeLetter: false })
    for (const h of ["/people/birthdays", "/people/anniversaries", "/sunday-school", "/people/clearances", "/families/updates", "/memberships", "/welcome-letter", "/accounting/dues"]) {
      expect(hrefs).not.toContain(h)
    }
    expect(hrefs).toContain("/people")
  })
})

it("gives every collapsible group a header icon", () => {
  for (const g of buildNavGroups(allTrueFlags)) {
    if (!g.headless) expect(g.icon).toBeDefined()
  }
})

describe("navFlagsFor / featureOn / attentionItems (#366)", () => {
  it("derives role flags and defaults counts to zero", () => {
    expect(navFlagsFor("OFFICE_ADMIN")).toMatchObject({
      isEditor: true, isAccounting: false, isAccountingViewer: true, isAdmin: false, pendingUpdates: 0,
    })
    expect(navFlagsFor(undefined)).toMatchObject({ isEditor: false, canViewPeople: false })
  })

  it("treats omitted features as all on", () => {
    expect(featureOn(undefined, "events")).toBe(true)
    expect(featureOn(new Set(["accounting"]), "events")).toBe(false)
  })

  it("lists visible actionable badges only", () => {
    const groups = buildNavGroups(navFlagsFor("ADMIN", { pendingUpdates: 2, membershipPending: 0, verifyPending: 5 }))
    expect(attentionItems(groups).map((i) => [i.href, i.badge])).toEqual([["/families/updates", 2]])
  })
})
