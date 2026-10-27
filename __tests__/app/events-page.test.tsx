/** @jest-environment node */
import Page from "@/app/(dashboard)/events/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ResyncEventsButton } from "@/components/events/ResyncEventsButton"
import { EmptyState } from "@/components/shared/EmptyState"
import { renderToStaticMarkup } from "react-dom/server"

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

// Server Component return = unevaluated element tree; walk it for a component.
function findElement(node: unknown, type: unknown): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== "object") return null
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (el.type === type) return el as { props: Record<string, unknown> }
  const children = el.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, type)
      if (found) return found
    }
  } else if (children) {
    return findElement(children, type)
  }
  return null
}

describe("EventsPage — resync button gate", () => {
  const OLD = { url: process.env.WEBSITE_SYNC_URL, secret: process.env.WEBSITE_SYNC_SECRET }
  beforeEach(() => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.event.findMany as jest.Mock).mockResolvedValue([])
  })
  afterEach(() => {
    if (OLD.url === undefined) delete process.env.WEBSITE_SYNC_URL
    else process.env.WEBSITE_SYNC_URL = OLD.url
    if (OLD.secret === undefined) delete process.env.WEBSITE_SYNC_SECRET
    else process.env.WEBSITE_SYNC_SECRET = OLD.secret
  })

  const render = () => Page({ searchParams: Promise.resolve({}) })

  it("hides the resync button when website sync is not configured", async () => {
    delete process.env.WEBSITE_SYNC_URL
    delete process.env.WEBSITE_SYNC_SECRET
    expect(findElement(await render(), ResyncEventsButton)).toBeNull()
  })

  it("shows the resync button to ADMIN when website sync is configured", async () => {
    process.env.WEBSITE_SYNC_URL = "https://example.com/hook"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    expect(findElement(await render(), ResyncEventsButton)).not.toBeNull()
  })

  it("hides the resync button from non-ADMIN even when configured", async () => {
    process.env.WEBSITE_SYNC_URL = "https://example.com/hook"
    process.env.WEBSITE_SYNC_SECRET = "shared-secret"
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    expect(findElement(await render(), ResyncEventsButton)).toBeNull()
  })
})

describe("EventsPage — empty states", () => {
  const empty = async (role: string, filter?: string) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
    const el = findElement(await Page({ searchParams: Promise.resolve(filter ? { filter } : {}) }), EmptyState)
    return el?.props as { title: string; actions: { href: string }[] } | undefined
  }
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.event.findMany as jest.Mock).mockResolvedValue([])
  })

  it("offers New event on a first run to an editor", async () => {
    ;(prisma.event.findFirst as jest.Mock).mockResolvedValue(null)
    const props = await empty("ADMIN")
    expect(props?.title).toBe("No events yet")
    expect(props?.actions.map((a) => a.href)).toEqual(["/events/new"])
  })

  it("hides the toolbar New event while the first-run empty state offers it", async () => {
    ;(prisma.event.findFirst as jest.Mock).mockResolvedValue(null)
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
    // Only the empty-state action carries it, not the toolbar link.
    expect(html.split(">New event<").length - 1).toBe(1)
    expect(html).not.toContain('<a href="/events/new">New event</a>')
    ;(prisma.event.findFirst as jest.Mock).mockResolvedValue({ id: 3 })
    const tab = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
    expect(tab).toContain(">New event<")
  })

  it("shows a VIEWER the first-run text without actions", async () => {
    ;(prisma.event.findFirst as jest.Mock).mockResolvedValue(null)
    const props = await empty("VIEWER")
    expect(props?.title).toBe("No events yet")
    expect(props?.actions).toEqual([])
  })

  it("points to all events when only this tab is empty", async () => {
    ;(prisma.event.findFirst as jest.Mock).mockResolvedValue({ id: 3 })
    const props = await empty("VIEWER", "past")
    expect(props?.title).toBe("No past events")
    expect(props?.actions.map((a) => a.href)).toEqual(["/events?filter=all"])
  })

  it("skips the existence check on the All tab", async () => {
    await empty("ADMIN", "all")
    expect(prisma.event.findFirst).not.toHaveBeenCalled()
  })
})
