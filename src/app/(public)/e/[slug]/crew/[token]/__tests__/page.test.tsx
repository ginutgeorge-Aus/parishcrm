import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/prisma", () => ({ prisma: { event: { findUnique: jest.fn() } } }))
const notFound = jest.fn(() => { throw new Error("NEXT_NOT_FOUND") })
jest.mock("next/navigation", () => ({ notFound: () => notFound() }))

import { prisma } from "@/lib/prisma"
import CrewPage from "@/app/(public)/e/[slug]/crew/[token]/page"

const event = {
  title: "Picnic",
  date: null,
  slug: "picnic",
  ticketTypes: [{ name: "Adult", capacity: 10, registrationItems: [{ quantity: 8 }] }],
  registrations: [
    { firstName: "Ann", lastName: "Bell", paymentStatus: "PAID", totalAmount: "50",
      items: [{ quantity: 2, ticketType: { name: "Adult" } }] },
  ],
}

beforeEach(() => jest.clearAllMocks())

it("renders the view for a valid token+slug", async () => {
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(event)
  const ui = await CrewPage({ params: Promise.resolve({ slug: "picnic", token: "tok" }) })
  const html = renderToStaticMarkup(ui)
  expect(html).toContain("Picnic")
  expect(html).toContain("Ann Bell")
  expect(html).toContain("Paid")
})

it("404s when the token matches no event", async () => {
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
  await expect(
    CrewPage({ params: Promise.resolve({ slug: "picnic", token: "bad" }) }),
  ).rejects.toThrow("NEXT_NOT_FOUND")
  expect(notFound).toHaveBeenCalled()
})

it("404s when the slug does not match the token's event", async () => {
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(event)
  await expect(
    CrewPage({ params: Promise.resolve({ slug: "wrong-slug", token: "tok" }) }),
  ).rejects.toThrow("NEXT_NOT_FOUND")
})
