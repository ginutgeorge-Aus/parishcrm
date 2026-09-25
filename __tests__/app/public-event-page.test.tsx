/** @jest-environment node */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
  },
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NOT_FOUND")
  }),
}))
jest.mock("@/components/public-event/EventHero", () => ({
  EventHero: jest.fn(() => null),
}))
jest.mock("@/components/public-event/RegistrationForm", () => ({ RegistrationForm: () => null }))

import { renderToStaticMarkup } from "react-dom/server"
import PublicEventPage from "@/app/(public)/e/[slug]/page"
import { prisma } from "@/lib/prisma"
import { EventHero } from "@/components/public-event/EventHero"

const mockEventFindUnique = prisma.event.findUnique as jest.Mock
const mockEventHero = EventHero as jest.Mock

beforeEach(() => jest.clearAllMocks())

function render(slug: string) {
  return PublicEventPage({ params: Promise.resolve({ slug }) })
}

it("404s on an unknown slug", async () => {
  mockEventFindUnique.mockResolvedValue(null)
  await expect(render("nope")).rejects.toThrow("NOT_FOUND")
})

it("404s on an unpublished event — same as unknown slug, no enumeration", async () => {
  mockEventFindUnique.mockResolvedValue({
    id: 1, slug: "draft", title: "Draft", isPublished: false, ticketTypes: [], customQuestions: null,
  })
  await expect(render("draft")).rejects.toThrow("NOT_FOUND")
})

it("renders a published event", async () => {
  mockEventFindUnique.mockResolvedValue({
    id: 1,
    slug: "gala",
    title: "Gala",
    description: null,
    date: null,
    endDate: null,
    location: null,
    recursLabel: null,
    startTime: null,
    isPublished: true,
    ticketTypes: [],
    customQuestions: null,
    images: [],
    updatedAt: new Date("2026-01-01"),
  })
  await expect(render("gala")).resolves.toBeTruthy()
})

it("passes the pasted imageUrl as bannerSrc to EventHero when no image is uploaded", async () => {
  mockEventFindUnique.mockResolvedValue({
    id: 1,
    slug: "hero-test",
    title: "Hero Test",
    description: null,
    date: null,
    endDate: null,
    location: null,
    recursLabel: null,
    startTime: null,
    isPublished: true,
    ticketTypes: [],
    customQuestions: null,
    imageUrl: "https://cdn.example.com/hero.jpg",
    images: [],
    updatedAt: new Date("2026-01-01"),
  })
  const ui = await render("hero-test")
  // The page returns a React element tree. Find the EventHero element and verify its props.
  function findEventHeroProps(node: any): Record<string, unknown> | null {
    if (!node || typeof node !== "object") return null
    if (node.type === mockEventHero || node.type === EventHero) return node.props
    if (node.props?.children) {
      const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children]
      for (const child of children) {
        const found = findEventHeroProps(child)
        if (found) return found
      }
    }
    return null
  }
  const heroProps = findEventHeroProps(ui)
  expect(heroProps).toMatchObject({ posterSrc: null, bannerSrc: "https://cdn.example.com/hero.jpg" })
})

it("shows a contact fallback message for a published, open event with no ticket types", async () => {
  mockEventFindUnique.mockResolvedValue({
    id: 1,
    slug: "misconfigured",
    title: "Misconfigured Event",
    description: null,
    date: null,
    endDate: null,
    location: null,
    recursLabel: null,
    startTime: null,
    isPublished: true,
    registrationClosed: false,
    registrationDeadline: null,
    ticketTypes: [],
    customQuestions: null,
    images: [],
    updatedAt: new Date("2026-01-01"),
  })
  const html = renderToStaticMarkup(await render("misconfigured"))
  expect(html).toMatch(/Registration isn&#x27;t available for this event yet/)
  expect(html).toMatch(/Please contact the church office/)
})
