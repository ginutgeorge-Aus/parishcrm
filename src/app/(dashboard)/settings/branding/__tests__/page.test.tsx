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

jest.mock("@/components/settings/BrandingForm", () => stub("BrandingForm"))
import BrandingSettingsPage from "@/app/(dashboard)/settings/branding/page"

it("guards with its own tab href", async () => {
  mockRequire.mockResolvedValue({ features: new Set() })
  await BrandingSettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings/branding")
})

it("propagates the guard's redirect", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(BrandingSettingsPage()).rejects.toThrow("NEXT_REDIRECT")
})

it("renders the branding form", async () => {
  mockRequire.mockResolvedValue({ features: new Set() })
  expect(renderToStaticMarkup(await BrandingSettingsPage())).toContain('data-c="BrandingForm"')
})
