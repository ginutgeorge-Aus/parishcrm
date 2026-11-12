/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT ${to}`) }),
}))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn().mockResolvedValue({ name: "Test Church" }) }))
jest.mock("@/lib/featureFlags", () => ({ getEnabledFeatures: jest.fn() }))
jest.mock("@/components/organiser/OrganiserHeader", () => ({
  OrganiserHeader: (p: { showEvents: boolean; showClasses: boolean; showGroups: boolean; home: { href: string } }) =>
    <header data-testid="hdr" data-events={String(p.showEvents)} data-classes={String(p.showClasses)} data-groups={String(p.showGroups)} data-home={p.home.href} />,
}))
jest.mock("@/components/SiteFooter", () => ({ SiteFooter: (p: { churchName: string }) => <footer>{p.churchName}</footer> }))

import { auth } from "@/auth"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { resolveFeatures } from "@/lib/features"
import OrganiserLayout from "@/app/(organiser)/layout"

const as = (role: string | null) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)
const render = async () => renderToStaticMarkup(await OrganiserLayout({ children: <p>child</p> }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(getEnabledFeatures as jest.Mock).mockResolvedValue(resolveFeatures({ events: true, sundaySchool: true }))
})

describe("(organiser) layout", () => {
  it("redirects anonymous to login", async () => {
    as(null)
    await expect(render()).rejects.toThrow("REDIRECT /login")
  })
  it.each(["VIEWER", "AUDITOR", "HEADMASTER"])("bounces %s home", async role => {
    as(role)
    await expect(render()).rejects.toThrow("REDIRECT /")
  })
  it("gives a TEACHER the Classes link only, homed on classes", async () => {
    as("TEACHER")
    const out = await render()
    expect(out).toContain('data-events="false"')
    expect(out).toContain('data-classes="true"')
    expect(out).toContain('data-groups="false"')
    expect(out).toContain('data-home="/my-classes"')
    expect(out).toContain("child")
    expect(out).toContain("Test Church")
  })
  it("gives an EVENT_ORGANISER events and groups", async () => {
    as("EVENT_ORGANISER")
    const out = await render()
    expect(out).toContain('data-events="true"')
    expect(out).toContain('data-groups="true"')
  })
  it("lets an editor through", async () => {
    as("ADMIN")
    expect(await render()).toContain("child")
  })
  it("hides Classes when the Sunday School feature is off", async () => {
    as("EVENT_ORGANISER")
    ;(getEnabledFeatures as jest.Mock).mockResolvedValue(resolveFeatures({ events: true, sundaySchool: false }))
    expect(await render()).toContain('data-classes="false"')
  })
})
