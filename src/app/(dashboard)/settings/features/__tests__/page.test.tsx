/** @jest-environment jsdom */
import { render } from "@testing-library/react"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
import { requireSettingsTab } from "@/lib/settingsAccess"
import { allowSettingsTab } from "@/test-utils/allowSettingsTab"
const mockRequire = requireSettingsTab as jest.Mock
/** Lets the guard pass and runs the page's load. */
const allow = (features: Set<string>) => allowSettingsTab(mockRequire, features)

/** Stub component that prints its name and JSON props. */
function stub(name: string) {
  return { [name]: (p: object) => <i data-c={name}>{JSON.stringify(p)}</i> }
}

beforeEach(() => jest.clearAllMocks())

jest.mock("@/lib/featureFlags")
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))
jest.mock("@/components/settings/FeaturesForm", () => stub("FeaturesForm"))
import FeaturesPage from "@/app/(dashboard)/settings/features/page"
import { getStoredOverrides } from "@/lib/featureFlags"
import { prisma } from "@/lib/prisma"
const mockFlag = prisma.appSetting.findUnique as jest.Mock

const page = () => FeaturesPage()
const OLD_DEMO = process.env.DEMO_MODE
beforeEach(() => { mockFlag.mockResolvedValue(null); delete process.env.DEMO_MODE })
afterAll(() => { if (OLD_DEMO === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = OLD_DEMO })

it("guards with its own tab href", async () => {
  allow(new Set())
  ;(getStoredOverrides as jest.Mock).mockResolvedValue({})
  await page()
  expect(mockRequire).toHaveBeenCalledWith("/settings/features", expect.any(Function))
})

it("propagates the guard's redirect before reading settings", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(page()).rejects.toThrow("NEXT_REDIRECT")
  expect(getStoredOverrides).not.toHaveBeenCalled()
})

it("passes the stored overrides and the pending flag as welcome, without ?welcome", async () => {
  allow(new Set())
  mockFlag.mockResolvedValue({ key: "features.onboarding", value: "pending" })
  ;(getStoredOverrides as jest.Mock).mockResolvedValue({ events: false })
  const { container } = render(await page())
  const form = container.querySelector('[data-c="FeaturesForm"]')
  expect(form).toHaveTextContent('"initial":{"events":false}')
  expect(form).toHaveTextContent('"welcome":true')
})

it("defaults welcome to false", async () => {
  allow(new Set())
  ;(getStoredOverrides as jest.Mock).mockResolvedValue({})
  const { container } = render(await page())
  expect(container.querySelector('[data-c="FeaturesForm"]')).toHaveTextContent('"welcome":false')
})

it("does not read the flag or welcome in the live demo", async () => {
  process.env.DEMO_MODE = "true"
  allow(new Set())
  ;(getStoredOverrides as jest.Mock).mockResolvedValue({})
  mockFlag.mockResolvedValue({ key: "features.onboarding", value: "pending" })
  const { container } = render(await page())
  expect(mockFlag).not.toHaveBeenCalled()
  expect(container.querySelector('[data-c="FeaturesForm"]')).toHaveTextContent('"welcome":false')
})
