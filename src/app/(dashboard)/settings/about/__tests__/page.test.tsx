import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
import { requireSettingsTab } from "@/lib/settingsAccess"
import AboutSettingsPage from "@/app/(dashboard)/settings/about/page"

const mockRequire = requireSettingsTab as jest.Mock
const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  delete process.env.NEXT_PUBLIC_APP_VERSION
  delete process.env.NEXT_PUBLIC_GIT_SHA
  mockRequire.mockResolvedValue({ features: new Set() })
})
afterAll(() => {
  process.env = ORIGINAL_ENV
})

it("guards with its own tab href", async () => {
  await AboutSettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings/about")
})

it("shows version and a 7-char build sha", async () => {
  process.env.NEXT_PUBLIC_APP_VERSION = "v1.10.0"
  process.env.NEXT_PUBLIC_GIT_SHA = "abcdef1234"
  const html = renderToStaticMarkup(await AboutSettingsPage())
  expect(html).toContain("v1.10.0")
  expect(html).toContain("abcdef1")
  expect(html).not.toContain("abcdef12")
})

it("falls back to dev and hides the Build row", async () => {
  const html = renderToStaticMarkup(await AboutSettingsPage())
  expect(html).toContain("dev")
  expect(html).not.toContain("Build")
})
