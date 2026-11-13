import { render } from "@testing-library/react"

jest.mock("@/lib/prisma", () => ({ prisma: { fundraiserEntry: { findUnique: jest.fn() } } }))
jest.mock("@/lib/featureFlags", () => ({ isFeatureOn: jest.fn() }))
const notFound = jest.fn(() => { throw new Error("NEXT_NOT_FOUND") })
jest.mock("next/navigation", () => ({ notFound: () => notFound() }))
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Map()) }))
jest.mock("@/lib/clientIp", () => ({ rateKeyFromHeaders: () => "ip" }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn() }))
jest.mock("@/lib/stripe", () => ({ stripeConfigured: jest.fn() }))
jest.mock("@/lib/fundraiserCheckout", () => ({ fundraiserSurchargeCents: jest.fn().mockResolvedValue(0) }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn().mockResolvedValue({ name: "Test Church", email: "office@example.com" }),
}))
jest.mock("../PayRemainingButton", () => ({
  PayRemainingButton: () => <div>PAY_BUTTON_MARKER</div>,
}))

import { prisma } from "@/lib/prisma"
import { isFeatureOn } from "@/lib/featureFlags"
import { rateLimit } from "@/lib/rateLimit"
import { stripeConfigured } from "@/lib/stripe"
import FundraiserPayPage from "../page"

const mFind = prisma.fundraiserEntry.findUnique as jest.Mock

const entry = (paid: string, online = true, deliveryPrice: string | null = null, delivery = false) => ({
  quantity: 4,
  unitPrice: delivery ? "12.00" : "10.00",
  delivery,
  bankRef: "FR0001",
  payments: [{ amount: paid }],
  fundraiser: {
    name: "Cake stall",
    unitLabel: "packet",
    deliveryPrice,
    event: { title: "Feast", onlinePaymentEnabled: online, passCardFee: false },
  },
})

const renderPage = async (token = "tok-7", search: Record<string, string> = {}) => {
  const ui = await FundraiserPayPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve(search) })
  return render(ui).container.textContent ?? ""
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(isFeatureOn as jest.Mock).mockResolvedValue(true)
  ;(rateLimit as jest.Mock).mockReturnValue(true)
  ;(stripeConfigured as jest.Mock).mockReturnValue(true)
})

it("unknown token → 404", async () => {
  mFind.mockResolvedValue(null)
  await expect(renderPage("nope")).rejects.toThrow("NEXT_NOT_FOUND")
  expect(mFind).toHaveBeenCalledWith(expect.objectContaining({ where: { publicToken: "nope" } }))
})

it("malformed token → 404 without a DB lookup", async () => {
  await expect(renderPage("bad token/..")).rejects.toThrow("NEXT_NOT_FOUND")
  expect(mFind).not.toHaveBeenCalled()
})

it("events feature off → 404", async () => {
  ;(isFeatureOn as jest.Mock).mockResolvedValue(false)
  await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND")
})

it("shows owed, paid, remaining and the pay button", async () => {
  mFind.mockResolvedValue(entry("10.00"))
  const text = await renderPage()
  expect(text).toContain("$40.00")
  expect(text).toContain("$10.00")
  expect(text).toContain("$30.00")
  expect(text).toContain("FR0001")
  expect(text).toContain("PAY_BUTTON_MARKER")
})

it("hides the button when nothing remains", async () => {
  mFind.mockResolvedValue(entry("40.00"))
  expect(await renderPage()).not.toContain("PAY_BUTTON_MARKER")
})

it("hides the button when Stripe is off", async () => {
  ;(stripeConfigured as jest.Mock).mockReturnValue(false)
  mFind.mockResolvedValue(entry("10.00"))
  expect(await renderPage()).not.toContain("PAY_BUTTON_MARKER")
})

it("hides the button when the event's online payment is off", async () => {
  mFind.mockResolvedValue(entry("10.00", false))
  expect(await renderPage()).not.toContain("PAY_BUTTON_MARKER")
})

it("rate-limited lookups get a notice, not the entry", async () => {
  ;(rateLimit as jest.Mock).mockReturnValue(false)
  const text = await renderPage()
  expect(text).toMatch(/too many requests/i)
  expect(mFind).not.toHaveBeenCalled()
})

it("shows no pickup/delivery text without a delivery price", async () => {
  mFind.mockResolvedValue(entry("0.00"))
  const text = await renderPage()
  expect(text).not.toContain("(pickup)")
  expect(text).not.toContain("(delivery)")
})

it("labels pickup and delivery when the fundraiser has a delivery price", async () => {
  mFind.mockResolvedValue(entry("0.00", true, "12.00", false))
  expect(await renderPage()).toContain("(pickup)")
  mFind.mockResolvedValue(entry("0.00", true, "12.00", true))
  const text = await renderPage()
  expect(text).toContain("(delivery)")
  expect(text).toContain("$48.00")
})
