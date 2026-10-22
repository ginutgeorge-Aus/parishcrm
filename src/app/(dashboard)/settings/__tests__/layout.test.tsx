/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({ redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }) }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ getEnabledFeatures: jest.fn().mockResolvedValue(new Set(["memberships"])) }))
jest.mock("@/components/DemoNotice", () => ({ DemoNotice: () => null }))
jest.mock("@/components/settings/SettingsTabs", () => ({
  SettingsTabs: ({ groups }: { groups: { tabs: { href: string }[] }[] }) => (
    <i data-c="tabs">{groups.flatMap((g) => g.tabs.map((t) => t.href)).join(",")}</i>
  ),
}))

import { auth } from "@/auth"
import SettingsLayout from "@/app/(dashboard)/settings/layout"

const mockAuth = auth as unknown as jest.Mock

it("redirects non-admins", async () => {
  mockAuth.mockResolvedValue({ user: { role: "PASTOR" } })
  await expect(SettingsLayout({ children: null })).rejects.toThrow(/^NEXT_REDIRECT \/$/)
})

it("renders the heading, the feature-filtered tabs and the page", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  const html = renderToStaticMarkup(await SettingsLayout({ children: <p>page</p> }))
  expect(html).toContain("<h1")
  expect(html).toContain("Settings")
  expect(html).toContain("/settings/members")
  expect(html).not.toContain("/settings/receipts")
  expect(html).toContain("<p>page</p>")
})
