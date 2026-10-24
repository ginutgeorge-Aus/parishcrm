import { organiserHome } from "@/lib/organiserHome"
import { resolveFeatures } from "@/lib/features"

const home = (o: Record<string, boolean>) => organiserHome(resolveFeatures(o))

it("is My Events while Events is on", () => {
  expect(home({ events: true, sundaySchool: true })).toEqual({ href: "/my-events", label: "My Events", isEventsHome: true })
})

it("is My Classes while Events is off and Sunday School is on", () => {
  expect(home({ events: false, sundaySchool: true })).toEqual({ href: "/my-classes", label: "My Classes", isEventsHome: false })
})

it("stays My Events (the notice) while both are off", () => {
  expect(home({ events: false, sundaySchool: false })).toEqual({ href: "/my-events", label: "My Events", isEventsHome: true })
})
