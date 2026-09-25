/** @jest-environment node */
import Page from "@/app/(dashboard)/events/[id]/registrations/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOTFOUND") }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    eventManager: { findMany: jest.fn() },
    registration: { groupBy: jest.fn() },
    paymentReminderSend: { groupBy: jest.fn() },
  },
}))
// The ADMIN branch loads the event-managers panel data (Task 8): a
// prisma.eventManager.findMany + the listAssignableOrganisers action.
jest.mock("@/lib/actions/eventAccess", () => ({
  listAssignableOrganisers: jest.fn(() => Promise.resolve([])),
}))
jest.mock("@/components/events/EventManagersPanel", () => ({ EventManagersPanel: () => null }))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/reports/eventAnalytics", () => ({
  fillRates: jest.fn(() => []),
  revenueByType: jest.fn(() => []),
  regsOverTime: jest.fn(() => []),
}))
jest.mock("@/components/events/RegistrationStats", () => ({ RegistrationStats: () => null }))
jest.mock("@/components/events/EventAnalytics", () => ({ EventAnalytics: () => null }))
jest.mock("@/components/events/RegistrationsTable", () => ({ RegistrationsTable: () => null }))
jest.mock("@/components/events/ExportButtons", () => ({ ExportButtons: () => null }))
jest.mock("@/components/events/SendPaymentRemindersClient", () => ({ SendPaymentRemindersClient: () => null }))

const mockEvent = {
  id: 1,
  title: "Church Camp",
  slug: "church-camp",
  date: new Date("2025-01-01"),
  recursLabel: null,
  isPublished: true,
  ticketTypes: [],
  registrations: [],
  _count: { registrations: 0, waitlist: 0, checkoutSessions: 0 },
}

// A Server Component's return value is an unevaluated React element tree —
// mocking the child as jest.fn() never records a call unless something
// actually renders the tree. Walk it directly to find a given component's
// props instead.
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

const pendingReg = {
  id: 101,
  firstName: "Alex",
  lastName: "Pending",
  email: "enc:alex@example.com",
  phone: null,
  totalAmount: 25,
  paymentStatus: "PENDING",
  items: [],
}

const paidReg = {
  id: 102,
  firstName: "Sam",
  lastName: "Paid",
  email: "enc:sam@example.com",
  phone: null,
  totalAmount: 40,
  paymentStatus: "PAID",
  items: [],
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
  ;(prisma.eventManager.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.registration.groupBy as jest.Mock).mockResolvedValue([])
  ;(prisma.paymentReminderSend.groupBy as jest.Mock).mockResolvedValue([])
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

it("builds reminderRows from PENDING registrations with decrypted email + merged lastRemindedAt", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
    ...mockEvent,
    registrations: [pendingReg, paidReg],
  })
  ;(prisma.eventManager.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.registration.groupBy as jest.Mock).mockResolvedValue([])
  ;(prisma.paymentReminderSend.groupBy as jest.Mock).mockResolvedValue([
    { registrationId: 101, _max: { sentAt: new Date("2026-09-01T00:00:00.000Z") } },
  ])
  const { SendPaymentRemindersClient } = jest.requireMock("@/components/events/SendPaymentRemindersClient") as {
    SendPaymentRemindersClient: unknown
  }
  const ui = await Page({ params: Promise.resolve({ id: "1" }) })
  const found = findElement(ui, SendPaymentRemindersClient)
  const rows = found?.props.rows as Array<{
    registrationId: number
    email: string | null
    amountDue: number
    lastRemindedAt: string | null
  }>
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    registrationId: 101,
    email: "alex@example.com",
    amountDue: 25,
    lastRemindedAt: "2026-09-01T00:00:00.000Z",
  })
})
