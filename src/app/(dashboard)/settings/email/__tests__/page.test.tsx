/** @jest-environment jsdom */
import { render } from "@testing-library/react"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
import { requireSettingsTab } from "@/lib/settingsAccess"
const mockRequire = requireSettingsTab as jest.Mock

/** Stub component that prints its name and JSON props. */
function stub(name: string) {
  return { [name]: (p: object) => <i data-c={name}>{JSON.stringify(p)}</i> }
}

beforeEach(() => jest.clearAllMocks())

jest.mock("@/lib/actions/settings", () => ({
  getBirthdayTemplate: jest.fn().mockResolvedValue({ subject: "s", body: "b" }),
  getAnniversaryTemplate: jest.fn().mockResolvedValue({ subject: "s", body: "b" }),
  getAutoEmailFlags: jest.fn().mockResolvedValue({ birthday: false, anniversary: false }),
}))
jest.mock("@/lib/emailTemplateStore", () => ({
  getEmailTemplate: jest.fn().mockResolvedValue({ subject: "s", intro: "i", body: "b", signoff: "x" }),
}))
jest.mock("@/lib/venueUsageSettings", () => ({ isVenueUsageEnabled: jest.fn(async () => false) }))
jest.mock("@/components/settings/BirthdayEmailForm", () => stub("BirthdayEmailForm"))
jest.mock("@/components/settings/AnniversaryEmailForm", () => stub("AnniversaryEmailForm"))
jest.mock("@/components/settings/AutoEmailToggles", () => stub("AutoEmailToggles"))
jest.mock("@/components/settings/EmailTemplatesSection", () => stub("EmailTemplatesSection"))
import EmailSettingsPage from "@/app/(dashboard)/settings/email/page"
import { visibleEmailTemplateKeys } from "@/lib/emailTemplates"
import type { FeatureKey } from "@/lib/features"
import { isVenueUsageEnabled } from "@/lib/venueUsageSettings"

it("guards with its own tab href", async () => {
  mockRequire.mockResolvedValue({ features: new Set() })
  await EmailSettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings/email")
})

it("propagates the guard's redirect", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(EmailSettingsPage()).rejects.toThrow("NEXT_REDIRECT")
})

it("renders blessing emails when celebrations is on", async () => {
  mockRequire.mockResolvedValue({ features: new Set(["celebrations"]) })
  const { container } = render(await EmailSettingsPage())
  for (const c of ["BirthdayEmailForm", "AnniversaryEmailForm", "AutoEmailToggles", "EmailTemplatesSection"]) {
    expect(container.querySelector(`[data-c="${c}"]`)).toBeInTheDocument()
  }
})

it("renders only the templates when celebrations is off, with the visible keys", async () => {
  const features = new Set<FeatureKey>()
  mockRequire.mockResolvedValue({ features })
  const { container } = render(await EmailSettingsPage())
  for (const c of ["BirthdayEmailForm", "AnniversaryEmailForm", "AutoEmailToggles"]) {
    expect(container.querySelector(`[data-c="${c}"]`)).not.toBeInTheDocument()
  }
  const section = container.querySelector('[data-c="EmailTemplatesSection"]')
  expect(section).toBeInTheDocument()
  expect(section).toHaveTextContent(JSON.stringify({ keys: visibleEmailTemplateKeys(features) }).slice(1, -1), { normalizeWhitespace: false })
})

it("includes the venue templates when venue usage is enabled", async () => {
  const features = new Set<FeatureKey>()
  mockRequire.mockResolvedValue({ features })
  ;(isVenueUsageEnabled as jest.Mock).mockResolvedValueOnce(true)
  const { container } = render(await EmailSettingsPage())
  const section = container.querySelector('[data-c="EmailTemplatesSection"]')
  expect(section).toHaveTextContent(JSON.stringify({ keys: visibleEmailTemplateKeys(features, { venueUsage: true }) }).slice(1, -1), { normalizeWhitespace: false })
  expect(section).toHaveTextContent("venueBookingRequest")
})
