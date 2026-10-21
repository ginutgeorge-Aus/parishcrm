import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
import { requireSettingsTab } from "@/lib/settingsAccess"
const mockRequire = requireSettingsTab as jest.Mock

/** Stub component that prints its name and JSON props. */
function stub(name: string) {
  return { [name]: (p: object) => <i data-c={name}>{JSON.stringify(p)}</i> }
}

beforeEach(() => jest.clearAllMocks())

jest.mock("@/lib/receiptSettings", () => ({ getReceiptSettings: jest.fn().mockResolvedValue({ marker: "r" }) }))
jest.mock("@/components/settings/ReceiptSettingsSection", () => stub("ReceiptSettingsSection"))
import ReceiptSettingsPage from "@/app/(dashboard)/settings/receipts/page"

it("guards with its own tab href", async () => {
  mockRequire.mockResolvedValue({ features: new Set() })
  await ReceiptSettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings/receipts")
})

it("propagates the guard's redirect", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(ReceiptSettingsPage()).rejects.toThrow("NEXT_REDIRECT")
})

it("renders the receipt section with the stored settings", async () => {
  mockRequire.mockResolvedValue({ features: new Set(["receipts"]) })
  const html = renderToStaticMarkup(await ReceiptSettingsPage())
  expect(html).toContain('data-c="ReceiptSettingsSection"')
  expect(html).toContain("&quot;marker&quot;:&quot;r&quot;")
})
