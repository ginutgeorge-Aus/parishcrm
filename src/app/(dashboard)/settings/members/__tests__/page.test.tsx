import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
import { requireSettingsTab } from "@/lib/settingsAccess"
const mockRequire = requireSettingsTab as jest.Mock

/** Stub component that prints its name and JSON props. */
function stub(name: string) {
  return { [name]: (p: object) => <i data-c={name}>{JSON.stringify(p)}</i> }
}

beforeEach(() => jest.clearAllMocks())

jest.mock("@/lib/letterSettings", () => ({ getLetterSettings: jest.fn().mockResolvedValue({}) }))
jest.mock("@/lib/membershipSettings", () => ({ getMembershipSettings: jest.fn().mockResolvedValue({}) }))
jest.mock("@/components/settings/LetterSettingsForm", () => stub("LetterSettingsForm"))
jest.mock("@/components/settings/MembershipSettingsForm", () => stub("MembershipSettingsForm"))
import MembersSettingsPage from "@/app/(dashboard)/settings/members/page"

it("guards with its own tab href", async () => {
  mockRequire.mockResolvedValue({ features: new Set() })
  await MembersSettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings/members")
})

it("propagates the guard's redirect", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(MembersSettingsPage()).rejects.toThrow("NEXT_REDIRECT")
})

it("renders only the letter form when only welcomeLetter is on", async () => {
  mockRequire.mockResolvedValue({ features: new Set(["welcomeLetter"]) })
  const html = renderToStaticMarkup(await MembersSettingsPage())
  expect(html).toContain('data-c="LetterSettingsForm"')
  expect(html).not.toContain('data-c="MembershipSettingsForm"')
})

it("renders only the membership form when only memberships is on", async () => {
  mockRequire.mockResolvedValue({ features: new Set(["memberships"]) })
  const html = renderToStaticMarkup(await MembersSettingsPage())
  expect(html).toContain('data-c="MembershipSettingsForm"')
  expect(html).not.toContain('data-c="LetterSettingsForm"')
})
