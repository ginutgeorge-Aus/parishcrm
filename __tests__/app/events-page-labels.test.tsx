import Page from "@/app/(dashboard)/events/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { render, screen } from "@testing-library/react"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findMany: jest.fn(), findFirst: jest.fn() },
    registration: { groupBy: jest.fn() },
    registrationItem: { groupBy: jest.fn() },
  },
}))
jest.mock("@/lib/actions/event", () => ({ deleteEvent: jest.fn() }))
jest.mock("@/components/events/DeleteEventButton", () => ({ DeleteEventButton: () => null }))
jest.mock("@/components/events/ResyncEventsButton", () => ({ ResyncEventsButton: () => null }))

describe("EventsPage — table headers", () => {
  it("renders sentence-case column headers when events exist", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.event.findMany as jest.Mock).mockResolvedValue([
      {
        id: 1,
        title: "Demo Fundraiser",
        slug: "demo-fundraiser",
        kind: "single",
        date: new Date("2030-01-01T00:00:00Z"),
        status: "PUBLISHED",
        ticketTypes: [{ id: 10 }],
      },
    ])
    ;(prisma.registration.groupBy as jest.Mock).mockResolvedValue([])
    ;(prisma.registrationItem.groupBy as jest.Mock).mockResolvedValue([])
    render(await Page({ searchParams: Promise.resolve({}) }))
    expect(screen.getByRole("columnheader", { name: "Tickets sold" })).toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Tickets Sold" })).not.toBeInTheDocument()
    expect(screen.getAllByText("Demo Fundraiser").length).toBeGreaterThan(0)
  })
})
