/** @jest-environment node */
import Page from "@/app/(dashboard)/events/[id]/check-in/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOTFOUND") }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { event: { findUnique: jest.fn() } } }))
jest.mock("@/components/events/CheckInList", () => ({ CheckInList: () => null }))

beforeEach(() => { jest.clearAllMocks() })

it("redirects an unauthenticated user", async () => {
  ;(auth as jest.Mock).mockResolvedValue(null)
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("REDIRECT")
})

it("redirects a VIEWER", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("REDIRECT")
})

it("renders for an editor", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
    id: 1, title: "Camp",
    registrations: [{
      publicToken: "REG-A", firstName: "Ann", lastName: "Lee",
      items: [{ ticketType: { name: "Adult" }, attendees: [{ id: 7, name: "Ann Lee", checkedInAt: null }] }],
    }],
  })
  const ui = await Page({ params: Promise.resolve({ id: "1" }) })
  expect(ui).toBeTruthy()
})

it("notFound when event missing", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("NOTFOUND")
})

it("notFound for a non-numeric id", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  await expect(Page({ params: Promise.resolve({ id: "abc" }) })).rejects.toThrow("NOTFOUND")
  expect(prisma.event.findUnique).not.toHaveBeenCalled()
})
