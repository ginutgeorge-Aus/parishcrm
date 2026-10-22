/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
import { requireSettingsTab } from "@/lib/settingsAccess"
const mockRequire = requireSettingsTab as jest.Mock
/**
 * Lets the guard pass and runs the page's load, as the real guard does.
 * @param features enabled features to report
 */
const allow = (features: Set<string>) =>
  mockRequire.mockImplementation(async (_href: string, load?: () => Promise<unknown>) => ({ features, data: await load?.() }))

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
  allow(new Set())
  ;(readRawOverrides as jest.Mock).mockResolvedValue({})
  await page()
  expect(mockRequire).toHaveBeenCalledWith("/settings/features", expect.any(Function))
})

it("propagates the guard's redirect before reading settings", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(page()).rejects.toThrow("NEXT_REDIRECT")
  expect(readRawOverrides).not.toHaveBeenCalled()
})

it("passes the stored overrides and welcome flag to the form", async () => {
  allow(new Set())
  ;(readRawOverrides as jest.Mock).mockResolvedValue({ events: false })
  const { container } = render(await page("1"))
  const form = container.querySelector('[data-c="FeaturesForm"]')
  expect(form).toHaveTextContent('"initial":{"events":false}')
  expect(form).toHaveTextContent('"welcome":true')
})

it("defaults welcome to false", async () => {
  allow(new Set())
  ;(readRawOverrides as jest.Mock).mockResolvedValue({})
  const { container } = render(await page())
  expect(container.querySelector('[data-c="FeaturesForm"]')).toHaveTextContent('"welcome":false')
})
