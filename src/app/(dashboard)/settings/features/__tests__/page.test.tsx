/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
import { requireSettingsTab } from "@/lib/settingsAccess"
const mockRequire = requireSettingsTab as jest.Mock

/** Stub component that prints its name and JSON props. */
function stub(name: string) {
  return { [name]: (p: object) => <i data-c={name}>{JSON.stringify(p)}</i> }
}

beforeEach(() => jest.clearAllMocks())

jest.mock("@/lib/featureFlags")
jest.mock("@/components/settings/FeaturesForm", () => stub("FeaturesForm"))
import FeaturesPage from "@/app/(dashboard)/settings/features/page"
import { readRawOverrides } from "@/lib/featureFlags"

const page = (welcome?: string) => FeaturesPage({ searchParams: Promise.resolve({ welcome }) })

it("guards with its own tab href", async () => {
  mockRequire.mockResolvedValue({ features: new Set() })
  ;(readRawOverrides as jest.Mock).mockResolvedValue({})
  await page()
  expect(mockRequire).toHaveBeenCalledWith("/settings/features")
})

it("propagates the guard's redirect before reading settings", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(page()).rejects.toThrow("NEXT_REDIRECT")
  expect(readRawOverrides).not.toHaveBeenCalled()
})

it("passes the stored overrides and welcome flag to the form", async () => {
  mockRequire.mockResolvedValue({ features: new Set() })
  ;(readRawOverrides as jest.Mock).mockResolvedValue({ events: false })
  const html = renderToStaticMarkup(await page("1"))
  expect(html).toContain("&quot;initial&quot;:{&quot;events&quot;:false}")
  expect(html).toContain("&quot;welcome&quot;:true")
})

it("defaults welcome to false", async () => {
  mockRequire.mockResolvedValue({ features: new Set() })
  ;(readRawOverrides as jest.Mock).mockResolvedValue({})
  expect(renderToStaticMarkup(await page())).toContain("&quot;welcome&quot;:false")
})
