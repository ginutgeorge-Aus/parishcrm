import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/prisma", () => ({ prisma: { event: { findUnique: jest.fn() } } }))
const notFound = jest.fn(() => { throw new Error("NEXT_NOT_FOUND") })
jest.mock("next/navigation", () => ({ notFound: () => notFound() }))
jest.mock("@/lib/stripe", () => ({ stripeConfigured: () => false }))
jest.mock("@/lib/formToken", () => ({ issueFormToken: () => "token" }))
// cardFeeSettings.ts imports next/cache's unstable_cache, which needs
// TextEncoder (unavailable in the jsdom test env) just to load the module —
// mock it out rather than pull that in (see reference-jest-nextserver-route-trap).
jest.mock("@/lib/cardFeeSettings", () => ({ getCardFeeConfig: jest.fn() }))
// Same unstable_cache/TextEncoder trap as cardFeeSettings.
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn().mockResolvedValue({ email: "office@example.com" }),
}))
// Client components mocked with a distinguishable marker so the test can
// assert absence, not just "renders nothing" (which would pass trivially).
jest.mock("@/components/public-event/RegistrationForm", () => ({
  RegistrationForm: ({ churchEmail }: { churchEmail?: string }) => (
    <div>REGISTRATION_FORM_MARKER {churchEmail}</div>
  ),
}))
jest.mock("@/components/public-event/WaitlistForm", () => ({
  WaitlistForm: () => <div>WAITLIST_FORM_MARKER</div>,
}))

import { prisma } from "@/lib/prisma"
import PublicEventPage from "@/app/(public)/e/[slug]/page"

const baseEvent = {
  title: "Spring Fete",
  description: null,
  date: new Date(Date.now() + 86400_000),
  endDate: null,
  location: null,
  organizers: [{ name: "Jane Doe", phone: null }],
  recursLabel: null,
  startTime: null,
  category: null,
  slug: "spring-fete",
  isPublished: true,
  imageUrl: null,
  updatedAt: null,
  customQuestions: [],
  passCardFee: false,
  onlinePaymentEnabled: false,
  tieredPricingEnabled: false,
  familyPricingTiers: [],
  familyWaiverEnabled: false,
  registrationClosed: true,
  registrationDeadline: null,
  images: [],
  ticketTypes: [
    { id: 1, name: "Adult", capacity: 10, price: 10, registrationItems: [{ quantity: 10 }] },
  ],
}

beforeEach(() => jest.clearAllMocks())

it("shows the closed panel and hides the form + waitlist when registration is closed", async () => {
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(baseEvent)
  const ui = await PublicEventPage({ params: Promise.resolve({ slug: "spring-fete" }) })
  const html = renderToStaticMarkup(ui)
  expect(html).toContain("Registration for Spring Fete is closed.")
  expect(html).not.toContain("REGISTRATION_FORM_MARKER")
  expect(html).not.toContain("WAITLIST_FORM_MARKER")
})

it("renders the form (not the closed panel) when registration is open", async () => {
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
    ...baseEvent,
    registrationClosed: false,
  })
  const ui = await PublicEventPage({ params: Promise.resolve({ slug: "spring-fete" }) })
  const html = renderToStaticMarkup(ui)
  expect(html).toContain("REGISTRATION_FORM_MARKER")
  expect(html).toContain("office@example.com") // Turnstile fallback contact
  expect(html).not.toContain("Registration for Spring Fete is closed.")
})
