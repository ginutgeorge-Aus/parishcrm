/** @jest-environment jsdom */
import { render } from "@testing-library/react"

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

jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: jest.fn().mockResolvedValue([]) } } }))
jest.mock("@/lib/mailConfig", () => ({ senderAddress: () => "office@example.com" }))
jest.mock("@/components/settings/ChurchInfoForm", () => stub("ChurchInfoForm"))
jest.mock("@/components/settings/AppSettingsForm", () => stub("AppSettingsForm"))
import GeneralSettingsPage from "@/app/(dashboard)/settings/page"

it("guards with its own tab href", async () => {
  allow(new Set())
  await GeneralSettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings", expect.any(Function))
})

it("propagates the guard's redirect", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(GeneralSettingsPage()).rejects.toThrow("NEXT_REDIRECT")
})

it.each([
  [["memberships"], true, false],
  [["events"], false, true],
])("renders church info and app settings; features %j gate membership/card fee", async (features, membership, cardFee) => {
  allow(new Set(features))
  const { container } = render(await GeneralSettingsPage())
  expect(container.querySelector('[data-c="ChurchInfoForm"]')).toBeInTheDocument()
  const settings = container.querySelector('[data-c="AppSettingsForm"]')
  expect(settings).toHaveTextContent(`"showMembership":${membership}`)
  expect(settings).toHaveTextContent(`"showCardFee":${cardFee}`)
})
