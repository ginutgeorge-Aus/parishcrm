/** @jest-environment node */
import Page from "@/app/(dashboard)/events/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ResyncEventsButton } from "@/components/events/ResyncEventsButton"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findMany: jest.fn() },
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
