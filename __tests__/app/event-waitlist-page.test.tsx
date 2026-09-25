/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"
import Page from "@/app/(dashboard)/events/[id]/waitlist/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOTFOUND") }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { event: { findUnique: jest.fn() } } }))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/components/events/WaitlistNotifyToggle", () => ({
  WaitlistNotifyToggle: () => null,
}))

const mockEvent = {
  id: 1,
  title: "Church Camp",
  waitlist: [
    {
      id: 10,
      name: "Jane Doe",
      email: "enc:jane@example.com",
      notifiedAt: null,
      ticketType: { name: "Adult" },
      createdAt: new Date("2025-01-01"),
    },
  ],
}

beforeEach(() => { jest.clearAllMocks() })

it("redirects an unauthenticated user", async () => {
  ;(auth as jest.Mock).mockResolvedValue(null)
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("REDIRECT")
})

it("redirects an AUDITOR (not in canViewPeople)", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("REDIRECT")
})

it("renders for an ADMIN", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
  const ui = await Page({ params: Promise.resolve({ id: "1" }) })
  expect(ui).toBeTruthy()
})

it("decrypts email in rendered output", async () => {
  const { safeDecrypt } = jest.requireMock("@/lib/crypto") as { safeDecrypt: jest.Mock }
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
  await Page({ params: Promise.resolve({ id: "1" }) })
  expect(safeDecrypt).toHaveBeenCalledWith("enc:jane@example.com")
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

// the "Joined" date was rendered with date-fns `format()`, which uses
// the server's local timezone (UTC in prod) instead of Australia/Sydney — a
// join late-evening UTC could render as the wrong calendar day.
it("renders the Joined date in Sydney time, not the server's local timezone", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
    ...mockEvent,
    // 22:30 UTC on 7 Jul 2026 = 8:30 AM Sydney on 8 Jul 2026 (AEST, +10) — a
    // UTC-local render would wrongly show 7 Jul.
    waitlist: [{ ...mockEvent.waitlist[0], createdAt: new Date("2026-07-07T22:30:00.000Z") }],
  })
  const ui = await Page({ params: Promise.resolve({ id: "1" }) })
  const html = renderToStaticMarkup(ui)
  expect(html).toContain("Wed 8 Jul 2026")
  expect(html).not.toContain("7 Jul 2026")
})
