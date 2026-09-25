/** @jest-environment node */
import Page from "@/app/(organiser)/my-events/[id]/registrations/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageEvent } from "@/lib/eventManager"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOTFOUND") }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    registration: { groupBy: jest.fn() },
    paymentReminderSend: { groupBy: jest.fn() },
  },
}))
jest.mock("@/lib/eventManager", () => ({ canManageEvent: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/components/events/RegistrationStats", () => ({ RegistrationStats: () => null }))
jest.mock("@/components/events/RegistrationsTable", () => ({ RegistrationsTable: () => null }))
jest.mock("@/components/events/ExportButtons", () => ({ ExportButtons: () => null }))
jest.mock("@/components/events/SendPaymentRemindersClient", () => ({ SendPaymentRemindersClient: () => null }))

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

const mockEvent = {
  id: 1,
  title: "Church Camp",
  slug: "church-camp",
  date: new Date("2025-01-01"),
  recursLabel: null,
  ticketTypes: [],
  registrations: [],
  _count: { registrations: 0 },
}

const pendingReg = {
  id: 201,
  firstName: "Casey",
  lastName: "Pending",
  email: "enc:casey@example.com",
  phone: null,
  totalAmount: 30,
  paymentStatus: "PENDING",
  items: [],
}

const cancelledReg = {
  id: 202,
  firstName: "Jordan",
  lastName: "Cancelled",
  email: "enc:jordan@example.com",
  phone: null,
  totalAmount: 15,
  paymentStatus: "CANCELLED",
  items: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(canManageEvent as jest.Mock).mockResolvedValue(true)
  ;(prisma.registration.groupBy as jest.Mock).mockResolvedValue([])
  ;(prisma.paymentReminderSend.groupBy as jest.Mock).mockResolvedValue([])
})

it("redirects an unauthenticated user", async () => {
  ;(auth as jest.Mock).mockResolvedValue(null)
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("REDIRECT")
})

it("notFound when the organiser doesn't manage this event (IDOR)", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(canManageEvent as jest.Mock).mockResolvedValue(false)
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("NOTFOUND")
  expect(prisma.event.findUnique).not.toHaveBeenCalled()
})

it("renders for an assigned organiser", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
  const ui = await Page({ params: Promise.resolve({ id: "1" }) })
  expect(ui).toBeTruthy()
})

it("notFound when event missing", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(null)
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("NOTFOUND")
})

it("notFound for a non-numeric id", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  await expect(Page({ params: Promise.resolve({ id: "abc" }) })).rejects.toThrow("NOTFOUND")
  expect(prisma.event.findUnique).not.toHaveBeenCalled()
})

// the organiser page had no `take` cap on registrations (unlike the
// admin twin's EVENT_REGISTRATIONS_CAP), so a high-volume event would
// decrypt/ship every registration with no bound.
it("caps the registrations query at 2000 rows, like the admin twin", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue(mockEvent)
  await Page({ params: Promise.resolve({ id: "1" }) })
  const call = (prisma.event.findUnique as jest.Mock).mock.calls[0][0]
  expect(call.include.registrations.take).toBe(2000)
})

it("computes headline stats from a DB rollup, not the capped in-memory list", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
    ...mockEvent,
    _count: { registrations: 5000 },
  })
  ;(prisma.registration.groupBy as jest.Mock).mockResolvedValue([
    { paymentStatus: "PAID", _count: { _all: 4000 }, _sum: { totalAmount: "100000" } },
    { paymentStatus: "CANCELLED", _count: { _all: 1000 }, _sum: { totalAmount: null } },
  ])
  const { RegistrationsTable } = jest.requireMock("@/components/events/RegistrationsTable") as {
    RegistrationsTable: unknown
  }
  const ui = await Page({ params: Promise.resolve({ id: "1" }) })
  const found = findElement(ui, RegistrationsTable)
  expect(found?.props.total).toBe(5000)
})

it("builds reminderRows from PENDING registrations with decrypted email + merged lastRemindedAt", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "EVENT_ORGANISER", id: "5" } })
  ;(prisma.event.findUnique as jest.Mock).mockResolvedValue({
    ...mockEvent,
    registrations: [pendingReg, cancelledReg],
  })
  ;(prisma.paymentReminderSend.groupBy as jest.Mock).mockResolvedValue([
    { registrationId: 201, _max: { sentAt: new Date("2026-09-01T00:00:00.000Z") } },
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
    registrationId: 201,
    email: "casey@example.com",
    amountDue: 30,
    lastRemindedAt: "2026-09-01T00:00:00.000Z",
  })
})
