/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: { event: { findUnique: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({ decrypt: (v: string) => v, safeDecrypt: (v: string) => v }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { renderToStaticMarkup } from "react-dom/server"
import PrintPage from "@/app/(print)/events/[id]/registrations/print/page"

const mockAuth = auth as jest.Mock
const mockEventFindUnique = prisma.event.findUnique as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

const makeProps = (id = "1") => ({ params: Promise.resolve({ id }) })

const event = {
  title: "Carols",
  date: new Date("2025-12-24"),
  recursLabel: null,
  registrations: [],
}

beforeEach(() => jest.clearAllMocks())

describe("registration PrintPage — role guard", () => {
  it("redirects unauthenticated users to /login", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(PrintPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/login")
  })

  it("redirects VIEWER to / (no PII access)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(PrintPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
    expect(mockEventFindUnique).not.toHaveBeenCalled()
  })

  it("redirects AUDITOR to / (no PII access)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    await expect(PrintPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
    expect(mockEventFindUnique).not.toHaveBeenCalled()
  })

  it("allows ADMIN to render", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockEventFindUnique.mockResolvedValue(event)
    const result = await PrintPage(makeProps())
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("allows PASTOR to render", async () => {
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "1" } })
    mockEventFindUnique.mockResolvedValue(event)
    const result = await PrintPage(makeProps())
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("lists attendee names under each registration", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockEventFindUnique.mockResolvedValue({
      ...event,
      registrations: [
        {
          id: 1,
          firstName: "Reg",
          lastName: "Istrant",
          email: "r@b.com",
          phone: null,
          totalAmount: "20",
          paymentStatus: "PAID",
          items: [{ quantity: 2, ticketType: { name: "Adult" }, attendees: [{ name: "Alice Garcia" }, { name: "Bob Garcia" }] }],
        },
      ],
    })
    const html = renderToStaticMarkup(await PrintPage(makeProps()))
    expect(html).toContain("Alice Garcia")
    expect(html).toContain("Bob Garcia")
    expect(html).toContain("Adult")
  })
})
