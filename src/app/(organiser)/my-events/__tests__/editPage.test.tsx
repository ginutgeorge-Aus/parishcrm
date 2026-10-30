import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => "/my-events/7/edit",
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { event: { findUnique: jest.fn() } } }))
jest.mock("@/lib/eventManager", () => ({ canManageEvent: jest.fn() }))
jest.mock("@/lib/actions/eventManaged", () => ({ updateManagedEvent: jest.fn() }))

import EditManagedEventPage from "@/app/(organiser)/my-events/[id]/edit/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageEvent } from "@/lib/eventManager"

const event = {
  id: 7, slug: "camp", kind: "one_off", title: "Youth Camp", description: "Fun", category: "youth",
  date: new Date("2026-08-01T00:00:00Z"), endDate: null, recurs: null, recursLabel: null, startTime: null,
  location: "Hall", organizers: [{ name: "Jo" }], updatedAt: new Date("2026-07-01T00:00:00Z"),
  images: [{ kind: "BANNER" }],
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "EVENT_ORGANISER" } })
  ;(canManageEvent as jest.Mock).mockResolvedValue(true)
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(event)
})

const props = (id = "7") => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })

it("redirects to login without a session", async () => {
  ;(auth as jest.Mock).mockResolvedValue(null)
  await expect(EditManagedEventPage(props())).rejects.toThrow("NEXT_REDIRECT /login")
})

it("404s for a non-manager without loading the event", async () => {
  ;(canManageEvent as jest.Mock).mockResolvedValue(false)
  await expect(EditManagedEventPage(props())).rejects.toThrow("NEXT_NOT_FOUND")
  expect(prisma.event.findUnique).not.toHaveBeenCalled()
})

it("404s for a non-numeric id", async () => {
  await expect(EditManagedEventPage(props("abc"))).rejects.toThrow("NEXT_NOT_FOUND")
})

it("renders the details form for a manager, with no money/publish fields", async () => {
  const html = renderToStaticMarkup(await EditManagedEventPage(props()))
  expect(html).toContain("Youth Camp")
  expect(html).toContain('name="title"')
  expect(html).toContain('name="location"')
  expect(html).toContain('name="updatedAt"')
  for (const forbidden of ['name="slug"', 'name="bankBsb"', 'name="registrationDeadline"', "ticketType.", 'name="onlinePaymentEnabled"']) {
    expect(html).not.toContain(forbidden)
  }
})
