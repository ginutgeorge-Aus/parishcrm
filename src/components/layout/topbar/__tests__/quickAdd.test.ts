import { buildQuickAddItems } from "../quickAdd"
import type { FeatureKey } from "@/lib/features"
import type { UserRole } from "@/lib/generated/prisma/enums"

const labels = (role: string | undefined, features?: ReadonlySet<FeatureKey>) =>
  buildQuickAddItems(role as UserRole | undefined, features).map((i) => i.label)

it("gives ADMIN and PASTOR every entry", () => {
  expect(labels("ADMIN")).toEqual(["Person", "Family", "Event", "Transaction"])
  expect(labels("PASTOR")).toEqual(["Person", "Family", "Event", "Transaction"])
})

it("gives OFFICE_ADMIN people/family/event but no transaction", () => {
  expect(labels("OFFICE_ADMIN")).toEqual(["Person", "Family", "Event"])
})

it("gives read-only roles nothing", () => {
  expect(labels("VIEWER")).toEqual([])
  expect(labels("AUDITOR")).toEqual([])
  expect(labels("EVENT_ORGANISER")).toEqual([])
  expect(labels(undefined)).toEqual([])
})

it("drops Event when the events feature is off and Transaction when accounting is off", () => {
  const on = new Set<FeatureKey>(["accounting"])
  expect(labels("ADMIN", on)).toEqual(["Person", "Family", "Transaction"])
  expect(labels("ADMIN", new Set<FeatureKey>())).toEqual(["Person", "Family"])
})

it("links each entry to its create page", () => {
  expect(buildQuickAddItems("ADMIN" as UserRole).map((i) => i.href)).toEqual([
    "/people/new", "/families/new", "/events/new", "/accounting/transactions/new",
  ])
})
