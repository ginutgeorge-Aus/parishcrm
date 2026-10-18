import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
jest.mock("@/lib/featureFlags")

import OrganiserMyEventsLayout from "@/app/(organiser)/my-events/layout"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { resolveFeatures } from "@/lib/features"

const withFeatures = (o: Record<string, boolean>) =>
  (getEnabledFeatures as jest.Mock).mockResolvedValue(resolveFeatures(o))

beforeEach(() => jest.clearAllMocks())

// /my-events is the organiser's home (middleware sends them here), so it must
// never 404 while Events is off: that would leave the organiser stuck.
it("renders its children while Events is on", async () => {
  withFeatures({ events: true })
  await expect(OrganiserMyEventsLayout({ children: "page" })).resolves.toBe("page")
})

it("sends the organiser to their classes while Events is off and Sunday School is on", async () => {
  withFeatures({ events: false, sundaySchool: true })
  await expect(OrganiserMyEventsLayout({ children: "page" })).rejects.toThrow("NEXT_REDIRECT /my-classes")
})

it("shows a friendly page (not a 404) while Events and Sunday School are both off", async () => {
  withFeatures({ events: false, sundaySchool: false })
  const html = renderToStaticMarkup(await OrganiserMyEventsLayout({ children: "page" }) as React.ReactElement)
  expect(html).toContain("Nothing to manage right now")
  expect(html).not.toContain("page")
})
