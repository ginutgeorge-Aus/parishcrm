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

jest.mock("@/lib/receiptSettings", () => ({ getReceiptSettings: jest.fn().mockResolvedValue({ marker: "r" }) }))
jest.mock("@/components/settings/ReceiptSettingsSection", () => stub("ReceiptSettingsSection"))
import ReceiptSettingsPage from "@/app/(dashboard)/settings/receipts/page"

it("guards with its own tab href", async () => {
  allow(new Set())
  await ReceiptSettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings/receipts", expect.any(Function))
})

it("propagates the guard's redirect", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(ReceiptSettingsPage()).rejects.toThrow("NEXT_REDIRECT")
})

it("renders the receipt section with the stored settings", async () => {
  allow(new Set(["receipts"]))
  const { container } = render(await ReceiptSettingsPage())
  const section = container.querySelector('[data-c="ReceiptSettingsSection"]')
  expect(section).toBeInTheDocument()
  expect(section).toHaveTextContent('"marker":"r"')
})
