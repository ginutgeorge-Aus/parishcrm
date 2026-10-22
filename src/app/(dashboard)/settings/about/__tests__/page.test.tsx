/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react"

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
  const { container } = render(await AboutSettingsPage())
  expect(container).toHaveTextContent("v1.10.0")
  expect(container).toHaveTextContent("abcdef1")
  expect(container).not.toHaveTextContent("abcdef12")
})

it("falls back to dev and hides the Build row", async () => {
  const { container } = render(await AboutSettingsPage())
  expect(container).toHaveTextContent("dev")
  expect(container).not.toHaveTextContent("Build")
})
