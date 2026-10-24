/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react"

jest.mock("next/navigation", () => ({ redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }) }))
jest.mock("@/auth", () => ({ getSession: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ getEnabledFeatures: jest.fn().mockResolvedValue(new Set(["memberships"])) }))
jest.mock("@/components/DemoNotice", () => ({ DemoNotice: () => null }))
jest.mock("@/components/settings/SettingsTabs", () => ({
  SettingsTabs: ({ groups }: { groups: { tabs: { href: string }[] }[] }) => (
    <i data-c="tabs">{groups.flatMap((g) => g.tabs.map((t) => t.href)).join(",")}</i>
  ),
}))

import { getSession } from "@/auth"
import SettingsLayout from "@/app/(dashboard)/settings/layout"

const mockAuth = getSession as unknown as jest.Mock

it("redirects non-admins", async () => {
  mockAuth.mockResolvedValue({ user: { role: "PASTOR" } })
  await expect(SettingsLayout({ children: null })).rejects.toThrow(/^NEXT_REDIRECT \/$/)
})

it("renders the heading, the feature-filtered tabs and the page", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  const { container } = render(await SettingsLayout({ children: <p>page</p> }))
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings")
  const tabs = container.querySelector('[data-c="tabs"]')
  expect(tabs).toHaveTextContent("/settings/members")
  expect(tabs).not.toHaveTextContent("/settings/receipts")
  expect(screen.getByText("page").tagName).toBe("P")
})
