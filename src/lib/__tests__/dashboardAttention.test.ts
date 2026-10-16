/** @jest-environment node */
import { buildAttentionItems, type AttentionCounts } from "@/lib/dashboardAttention"
import { UserRole } from "@/lib/generated/prisma/enums"

const ALL: AttentionCounts = {
  pendingFamilyUpdates: 2,
  pendingMemberships: 3,
  unreconciledTransactions: 4,
  openPettyCash: 1,
  upcomingBirthdays: 5,
}

/** Labels of the items a role sees for the given counts. */
const labelsFor = (role: UserRole | undefined, counts: AttentionCounts = ALL) =>
  buildAttentionItems(role, counts).map((i) => i.key)

describe("buildAttentionItems", () => {
  it("shows ADMIN every item, in priority order", () => {
    expect(labelsFor(UserRole.ADMIN)).toEqual([
      "familyUpdates",
      "memberships",
      "unreconciled",
      "pettyCash",
      "birthdays",
    ])
  })

  it("gives each item its count and resolving link", () => {
    const items = buildAttentionItems(UserRole.ADMIN, ALL)
    expect(items.find((i) => i.key === "memberships")).toMatchObject({ count: 3, href: "/memberships?status=PENDING" })
    expect(items.find((i) => i.key === "familyUpdates")).toMatchObject({ count: 2, href: "/families/updates" })
    expect(items.find((i) => i.key === "birthdays")).toMatchObject({ count: 5, href: "/people/birthdays" })
  })

  it("hides zero-count items", () => {
    expect(labelsFor(UserRole.ADMIN, { ...ALL, pendingMemberships: 0, openPettyCash: 0 })).toEqual([
      "familyUpdates",
      "unreconciled",
      "birthdays",
    ])
  })

  it("returns nothing when every count is zero (the all-caught-up state)", () => {
    const zero: AttentionCounts = {
      pendingFamilyUpdates: 0,
      pendingMemberships: 0,
      unreconciledTransactions: 0,
      openPettyCash: 0,
      upcomingBirthdays: 0,
    }
    expect(buildAttentionItems(UserRole.ADMIN, zero)).toEqual([])
  })

  it("gives AUDITOR accounting items only — no member-PII or editor items", () => {
    expect(labelsFor(UserRole.AUDITOR)).toEqual(["unreconciled", "pettyCash"])
  })

  it("gives VIEWER people items only — no editor or accounting items", () => {
    expect(labelsFor(UserRole.VIEWER)).toEqual(["birthdays"])
  })

  it("gives OFFICE_ADMIN editor, accounting-view and people items", () => {
    expect(labelsFor(UserRole.OFFICE_ADMIN)).toEqual([
      "familyUpdates",
      "memberships",
      "unreconciled",
      "pettyCash",
      "birthdays",
    ])
  })

  it("gives an unknown/organiser role nothing", () => {
    expect(labelsFor(UserRole.EVENT_ORGANISER)).toEqual([])
    expect(labelsFor(undefined)).toEqual([])
  })

  it("uses the singular label for a count of one", () => {
    const [item] = buildAttentionItems(UserRole.ADMIN, {
      pendingFamilyUpdates: 0,
      pendingMemberships: 1,
      unreconciledTransactions: 0,
      openPettyCash: 0,
      upcomingBirthdays: 0,
    })
    expect(item.label).toBe("Membership application to review")
  })

  it("links unreconciled to a specific reconciliation view when one is given", () => {
    const items = buildAttentionItems(UserRole.ADMIN, ALL, {
      unreconciledHref: "/accounting/reconciliation?paymentAccount=7&status=pending",
    })
    expect(items.find((i) => i.key === "unreconciled")?.href).toBe(
      "/accounting/reconciliation?paymentAccount=7&status=pending",
    )
  })
})
