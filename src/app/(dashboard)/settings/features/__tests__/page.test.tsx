import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags")
jest.mock("@/components/DemoNotice", () => ({ DemoNotice: () => null }))
jest.mock("@/components/settings/FeaturesForm", () => ({
  FeaturesForm: ({ initial, welcome }: { initial: object; welcome: boolean }) => (
    <i data-initial={JSON.stringify(initial)} data-welcome={String(welcome)} />
  ),
}))

import FeaturesPage from "@/app/(dashboard)/settings/features/page"
import { auth } from "@/auth"
import { readRawOverrides } from "@/lib/featureFlags"

const page = (welcome?: string) => FeaturesPage({ searchParams: Promise.resolve({ welcome }) })

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
})

it("redirects a non-admin before reading settings", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "2", role: "OFFICE_ADMIN" } })
  await expect(page()).rejects.toThrow("NEXT_REDIRECT")
  expect(readRawOverrides).not.toHaveBeenCalled()
})

it("passes the stored overrides to the form", async () => {
  ;(readRawOverrides as jest.Mock).mockResolvedValue({ events: false })
  const html = renderToStaticMarkup(await page())
  expect(html).toContain("Features")
  expect(html).toContain('data-initial="{&quot;events&quot;:false}"')
  expect(html).toContain('data-welcome="false"')
})

it("shows the welcome banner on first run (?welcome=1)", async () => {
  const html = renderToStaticMarkup(await page("1"))
  expect(html).toContain('data-welcome="true"')
})
