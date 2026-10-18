import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
jest.mock("next/link", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    registration: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/actions/settings", () => ({
  getBirthdayTemplate: jest.fn().mockResolvedValue({ subject: "s", body: "b" }),
  getAnniversaryTemplate: jest.fn().mockResolvedValue({ subject: "s", body: "b" }),
  getAutoEmailFlags: jest.fn().mockResolvedValue({ birthday: false, anniversary: false }),
}))
jest.mock("@/lib/emailTemplateStore", () => ({
  getEmailTemplate: jest.fn().mockResolvedValue({ subject: "s", intro: "i", body: "b", signoff: "x" }),
}))
jest.mock("@/lib/letterSettings", () => ({ getLetterSettings: jest.fn().mockResolvedValue({}) }))
jest.mock("@/lib/membershipSettings", () => ({ getMembershipSettings: jest.fn().mockResolvedValue({}) }))
jest.mock("@/lib/receiptSettings", () => ({ getReceiptSettings: jest.fn().mockResolvedValue({}) }))
jest.mock("@/lib/mailConfig", () => ({ senderAddress: () => "office@example.com" }))
jest.mock("@/components/DemoNotice", () => ({ DemoNotice: () => null }))

/** Stub a client component as a marker carrying its name (and tab keys when given). */
function mockStub(name: string) {
  return { [name]: (p: { keys?: string[] }) => <i data-c={name}>{p.keys ? p.keys.join(",") : ""}</i> }
}
jest.mock("@/components/settings/AppSettingsForm", () => ({
  AppSettingsForm: (p: { showMembership: boolean; showCardFee: boolean }) => (
    <i data-c="AppSettingsForm" data-membership={String(p.showMembership)} data-cardfee={String(p.showCardFee)} />
  ),
}))
jest.mock("@/components/settings/BirthdayEmailForm", () => mockStub("BirthdayEmailForm"))
jest.mock("@/components/settings/AnniversaryEmailForm", () => mockStub("AnniversaryEmailForm"))
jest.mock("@/components/settings/AutoEmailToggles", () => mockStub("AutoEmailToggles"))
jest.mock("@/components/settings/ChurchInfoForm", () => mockStub("ChurchInfoForm"))
jest.mock("@/components/settings/BrandingForm", () => mockStub("BrandingForm"))
jest.mock("@/components/settings/LetterSettingsForm", () => mockStub("LetterSettingsForm"))
jest.mock("@/components/settings/MembershipSettingsForm", () => mockStub("MembershipSettingsForm"))
jest.mock("@/components/settings/ActivityFeed", () => mockStub("ActivityFeed"))
jest.mock("@/components/settings/EmailTemplatesSection", () => mockStub("EmailTemplatesSection"))
jest.mock("@/components/settings/ReceiptSettingsSection", () => mockStub("ReceiptSettingsSection"))
jest.mock("@/components/settings/SettingsNav", () => ({
  SETTINGS_NAV_ITEMS: [{ id: "general" }, { id: "members" }, { id: "receipts" }],
  SettingsNav: ({ items }: { items: { id: string }[] }) => <nav>{items.map((i) => i.id).join(",")}</nav>,
}))

import SettingsPage from "@/app/(dashboard)/settings/page"
import { auth } from "@/auth"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { resolveFeatures, FEATURE_KEYS } from "@/lib/features"

const allOff = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false]))

/** Render the page as ADMIN with the given enabled set. */
async function renderWith(enabled: Set<string>) {
  ;(getEnabledFeatures as jest.Mock).mockResolvedValue(enabled)
  return renderToStaticMarkup(await SettingsPage())
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
})

it("redirects a non-admin", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "2", role: "PASTOR" } })
  await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT")
})

it("shows every feature-owned section and template while all features are on", async () => {
  const html = await renderWith(resolveFeatures({}))
  for (const c of ["BirthdayEmailForm", "AutoEmailToggles", "LetterSettingsForm", "MembershipSettingsForm", "ReceiptSettingsSection"]) {
    expect(html).toContain(`data-c="${c}"`)
  }
  expect(html).toContain("<nav>general,members,receipts</nav>")
  expect(html).toContain("welcome,familyUpdate,receipt,dgrReceipt")
  expect(html).toContain('data-membership="true" data-cardfee="true"')
})

it("hides feature-owned sections, nav entries and templates while their features are off", async () => {
  const html = await renderWith(resolveFeatures(allOff))
  for (const c of ["BirthdayEmailForm", "AutoEmailToggles", "LetterSettingsForm", "MembershipSettingsForm", "ReceiptSettingsSection"]) {
    expect(html).not.toContain(`data-c="${c}"`)
  }
  expect(html).toContain('data-c="ChurchInfoForm"')
  expect(html).toContain('data-membership="false" data-cardfee="false"')
  expect(html).toContain("<nav>general</nav>")
  expect(html).toMatch(/data-c="EmailTemplatesSection">welcome</)
})

it("shows the members section with only the enabled half", async () => {
  const html = await renderWith(resolveFeatures({ ...allOff, memberships: true }))
  expect(html).toContain('data-c="MembershipSettingsForm"')
  expect(html).not.toContain('data-c="LetterSettingsForm"')
})
