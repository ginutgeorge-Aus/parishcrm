/** @jest-environment node */
import {
  buildAttentionItems,
  canHaveAttentionItems,
  toUnreconciledRows,
  unreconciledHref,
  type AttentionCounts } from "@/lib/dashboardAttention"
import { UserRole } from "@/lib/generated/prisma/enums"

const ALL: AttentionCounts = {
  pendingFamilyUpdates: 2,
  pendingMemberships: 3,
  unreconciled: [
    { paymentAccountId: 7, count: 1, earliest: new Date("2026-01-05T00:00:00Z") },
    { paymentAccountId: 9, count: 3, earliest: new Date("2025-11-20T00:00:00Z") },
  ],
  openPettyCash: 1,
  upcomingBirthdays: 5,
}

const NONE: AttentionCounts = {
  pendingFamilyUpdates: 0,
  pendingMemberships: 0,
  unreconciled: [],
  openPettyCash: 0,
  upcomingBirthdays: 0,
}

/** Keys of the items a role sees for the given counts. */
const keysFor = (role: UserRole | undefined, counts: AttentionCounts = ALL) =>
  buildAttentionItems(role, counts).map((i) => i.key)

describe("buildAttentionItems", () => {
  it("shows ADMIN every item, in priority order", () => {
    expect(keysFor(UserRole.ADMIN)).toEqual(["familyUpdates", "memberships", "unreconciled", "pettyCash", "birthdays"])
  })

  it("gives each item its count and resolving link", () => {
    const items = buildAttentionItems(UserRole.ADMIN, ALL)
    expect(items.find((i) => i.key === "memberships")).toMatchObject({ count: 3, href: "/memberships?status=PENDING" })
    expect(items.find((i) => i.key === "familyUpdates")).toMatchObject({ count: 2, href: "/families/updates" })
    expect(items.find((i) => i.key === "birthdays")).toMatchObject({ count: 5, href: "/people/birthdays" })
    expect(items.find((i) => i.key === "unreconciled")).toMatchObject({
      count: 4,
      href: "/accounting/reconciliation?paymentAccount=9&from=2025-11-20&status=pending",
    })
  })

  it("hides zero-count items", () => {
    expect(keysFor(UserRole.ADMIN, { ...ALL, pendingMemberships: 0, openPettyCash: 0, unreconciled: [] })).toEqual([
      "familyUpdates",
      "birthdays",
    ])
  })

  it("returns nothing when every count is zero (the all-caught-up state)", () => {
    expect(buildAttentionItems(UserRole.ADMIN, NONE)).toEqual([])
  })

  it("gives PASTOR the same items as ADMIN", () => {
    expect(keysFor(UserRole.PASTOR)).toEqual(keysFor(UserRole.ADMIN))
  })

  it("keeps view-only accounting roles off the accounting rows (they can't reconcile or close a session)", () => {
    expect(keysFor(UserRole.AUDITOR)).toEqual([])
    expect(keysFor(UserRole.OFFICE_ADMIN)).toEqual(["familyUpdates", "memberships", "birthdays"])
  })

  it("gives VIEWER people items only", () => {
    expect(keysFor(UserRole.VIEWER)).toEqual(["birthdays"])
  })

  it("gives an unknown/organiser role nothing", () => {
    expect(keysFor(UserRole.EVENT_ORGANISER)).toEqual([])
    expect(keysFor(undefined)).toEqual([])
  })

  it("uses the singular label for a count of one", () => {
    const [item] = buildAttentionItems(UserRole.ADMIN, { ...NONE, pendingMemberships: 1 })
    expect(item.label).toBe("Membership application to review")
  })

  it("flags a capped birthday count as a lower bound", () => {
    const capped = buildAttentionItems(UserRole.ADMIN, { ...NONE, upcomingBirthdays: 2, birthdaysTruncated: true })
    expect(capped[0]).toMatchObject({ key: "birthdays", count: 2, atLeast: true })
    const exact = buildAttentionItems(UserRole.ADMIN, { ...NONE, upcomingBirthdays: 2 })
    expect(exact[0].atLeast).toBeFalsy()
  })
})

describe("unreconciled row label", () => {
  it("notes the account count when several accounts are pending (the link opens only the busiest)", () => {
    const item = buildAttentionItems(UserRole.ADMIN, ALL).find((i) => i.key === "unreconciled")
    expect(item?.count).toBe(4)
    expect(item?.label).toBe("Unreconciled transactions across 2 accounts")
  })

  it("keeps the plain label for a single account", () => {
    const item = buildAttentionItems(UserRole.ADMIN, { ...ALL, unreconciled: [ALL.unreconciled[1]] }).find(
      (i) => i.key === "unreconciled",
    )
    expect(item?.label).toBe("Unreconciled transactions")
  })
})

describe("canHaveAttentionItems", () => {
  it("is false only for roles with no actionable item (AUDITOR)", () => {
    expect(canHaveAttentionItems(UserRole.AUDITOR)).toBe(false)
    expect(canHaveAttentionItems(undefined)).toBe(false)
    expect(canHaveAttentionItems(UserRole.VIEWER)).toBe(true)
    expect(canHaveAttentionItems(UserRole.OFFICE_ADMIN)).toBe(true)
    expect(canHaveAttentionItems(UserRole.ADMIN)).toBe(true)
  })
})

describe("toUnreconciledRows", () => {
  it("maps complete groups and drops ones without an account or oldest date", () => {
    const d = new Date("2026-01-01T00:00:00Z")
    expect(
      toUnreconciledRows([
        { paymentAccountId: 1, _count: 2, _min: { date: d } },
        { paymentAccountId: null, _count: 1, _min: { date: d } },
        { paymentAccountId: 3, _count: 1, _min: { date: null } },
      ]),
    ).toEqual([{ paymentAccountId: 1, count: 2, earliest: d }])
  })
})

describe("unreconciledHref", () => {
  it("links the account with the most pending rows from its oldest one", () => {
    expect(unreconciledHref(ALL.unreconciled)).toBe(
      "/accounting/reconciliation?paymentAccount=9&from=2025-11-20&status=pending",
    )
  })

  it("breaks ties on the lowest account id", () => {
    const d = new Date("2026-02-01T00:00:00Z")
    expect(
      unreconciledHref([
        { paymentAccountId: 5, count: 2, earliest: d },
        { paymentAccountId: 3, count: 2, earliest: d },
      ]),
    ).toBe("/accounting/reconciliation?paymentAccount=3&from=2026-02-01&status=pending")
  })

  it("falls back to the pending filter with no rows", () => {
    expect(unreconciledHref([])).toBe("/accounting/reconciliation?status=pending")
  })
})
