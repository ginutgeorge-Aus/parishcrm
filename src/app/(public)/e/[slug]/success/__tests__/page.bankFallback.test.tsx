import { render } from "@testing-library/react"

jest.mock("@/lib/prisma", () => ({
  prisma: { event: { findUnique: jest.fn() }, registration: { findFirst: jest.fn() } },
}))
jest.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND") } }))
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Map()) }))
jest.mock("@/lib/clientIp", () => ({ rateKeyFromHeaders: () => "ip" }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/stripe", () => ({ stripeConfigured: jest.fn(() => false) }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn().mockResolvedValue({ name: "Test Church", email: "office@example.com" }),
}))
jest.mock("@/components/QrCode", () => ({ QrCode: () => null }))
jest.mock("../PayNowButton", () => ({ PayNowButton: () => <div>PAY_NOW_MARKER</div> }))

import { prisma } from "@/lib/prisma"
import SuccessPage from "../page"

const event = (bank: { bankBsb: string | null; bankAccount: string | null }) => ({
  id: 1, title: "Feast", isPublished: true, ...bank,
  date: null, endDate: null, description: null, location: null,
  familyWaiverEnabled: false, familyWaiverThreshold: 4, organizers: [],
  onlinePaymentEnabled: false, passCardFee: false,
})
const registration = {
  paymentStatus: "PENDING", paymentRef: null, publicToken: "tok1", totalAmount: "25.00",
  firstName: "A", lastName: "B", items: [],
}

const renderPage = async () => {
  const ui = await SuccessPage({
    params: Promise.resolve({ slug: "feast" }),
    searchParams: Promise.resolve({ ref: "tok1" }),
  })
  return render(ui).container.textContent ?? ""
}

beforeEach(() => {
  ;(prisma.registration.findFirst as jest.Mock).mockResolvedValue(registration)
})

it("blank BSB and account: shows the office-will-send sentence, no bank block", async () => {
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(event({ bankBsb: null, bankAccount: "  " }))
  const text = await renderPage()
  expect(text).toContain("The church office will send you payment details.")
  expect(text).not.toContain("Bank transfer details")
  expect(text).not.toContain("Account number")
})

it("bank details set: shows the bank block", async () => {
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(event({ bankBsb: "012-345", bankAccount: "99887766" }))
  const text = await renderPage()
  expect(text).toContain("Bank transfer details")
  expect(text).toContain("012-345")
  expect(text).toContain("99887766")
  expect(text).not.toContain("The church office will send you payment details.")
})
