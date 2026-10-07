/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: { findMany: jest.fn() },
    paymentAccount: { findMany: jest.fn() },
    person: { findMany: jest.fn(), count: jest.fn() },
    family: { count: jest.fn(), findMany: jest.fn() },
    pettyCashSession: { count: jest.fn() },
    event: { count: jest.fn() },
    registration: { findMany: jest.fn() },
    transaction: { aggregate: jest.fn() },
    auditLog: { findMany: jest.fn() },
    familyUpdateSubmission: { count: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/dashboard/BirthdayWidget", () => ({ BirthdayWidget: () => null }))
jest.mock("@/components/dashboard/MarriageAnniversaryWidget", () => ({ MarriageAnniversaryWidget: () => null }))

import { PERSON_FETCH_CAP } from "@/lib/constants"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import DashboardPage from "@/app/(dashboard)/page"
import { MarriageAnniversaryWidget } from "@/components/dashboard/MarriageAnniversaryWidget"

const mockAuth = auth as jest.Mock
const mockPersonFindMany = prisma.person.findMany as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

function primeMocks() {
  ;(prisma.accountOpeningBalance.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.paymentAccount.findMany as jest.Mock).mockResolvedValue([])
  mockPersonFindMany.mockResolvedValue([])
  ;(prisma.person.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.family.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.family.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.pettyCashSession.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.event.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.registration.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } })
  ;(prisma.auditLog.findMany as jest.Mock).mockResolvedValue([])
}

beforeEach(() => jest.clearAllMocks())

describe("DashboardPage", () => {
  it("redirects to /login when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(DashboardPage()).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/login")
  })

  it("bounds the birthday person.findMany with take: PERSON_FETCH_CAP + 1", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    expect(mockPersonFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dateOfBirth: { not: null }, archivedAt: null },
        take: PERSON_FETCH_CAP + 1,
      })
    )
  })

  it("bounds the marriage-anniversary family.findMany with take: PERSON_FETCH_CAP + 1", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    expect(prisma.family.findMany as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { marriageDate: { not: null }, archivedAt: null },
        take: PERSON_FETCH_CAP + 1,
      })
    )
  })

  it("every person.findMany call is bounded by take: PERSON_FETCH_CAP + 1", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    expect(mockPersonFindMany).toHaveBeenCalledTimes(1)
    for (const call of mockPersonFindMany.mock.calls) {
      expect(call[0]).toHaveProperty("take", PERSON_FETCH_CAP + 1)
    }
  })
})

describe("DashboardPage date math (Sydney day, UTC-midnight bounds)", () => {
  // 2026-02-28T14:00Z is 01:00 on 1 Mar in Sydney (AEDT +11) while the UTC
  // clock is still in February. Local getters are also forced to a UTC-5 host
  // (process.env.TZ isn't re-read once Jest's worker starts), so any
  // server-local date math shows up as a day/month shift regardless of the
  // machine running the suite.
  beforeEach(() => {
    simulateWestOfUtcLocalGetters()
    jest.useFakeTimers({
      now: new Date("2026-02-28T14:00:00.000Z"),
      doNotFake: ["nextTick", "setImmediate", "queueMicrotask"],
    })
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it("queries giving for the Sydney month and the same month last year at UTC midnight", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    const aggregate = prisma.transaction.aggregate as jest.Mock
    const dateRanges = aggregate.mock.calls.map((c) => c[0].where.date)
    expect(dateRanges).toContainEqual({
      gte: new Date("2026-03-01T00:00:00.000Z"),
      lt: new Date("2026-04-01T00:00:00.000Z"),
    })
    expect(dateRanges).toContainEqual({
      gte: new Date("2025-03-01T00:00:00.000Z"),
      lt: new Date("2025-04-01T00:00:00.000Z"),
    })
  })

  it("bounds 'added (30 days)' and upcoming events on UTC-midnight Sydney dates", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    expect(prisma.family.count as jest.Mock).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date("2026-01-30T00:00:00.000Z") }, archivedAt: null },
    })
    const eventWhere = (prisma.event.count as jest.Mock).mock.calls[0][0].where
    expect(eventWhere.OR[0].date).toEqual({
      gte: new Date("2026-03-01T00:00:00.000Z"),
      lte: new Date("2026-03-31T00:00:00.000Z"),
    })
  })

  it("lists this Sydney month's wedding anniversaries by UTC month", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    ;(prisma.family.findMany as jest.Mock).mockResolvedValue([
      { id: 2, name: "February Family", marriageDate: new Date("2000-02-28T00:00:00.000Z"), people: [] },
      { id: 1, name: "March Family", marriageDate: new Date("2000-03-01T00:00:00.000Z"), people: [] },
    ])
    const el = await DashboardPage()
    const widget = findElement(el, (e) => e.type === MarriageAnniversaryWidget)
    expect(widget.props.families.map((f: { id: number }) => f.id)).toEqual([1])
  })
})

/**
 * Make Date's local getters report a UTC-5 wall clock, as on a west-of-UTC
 * host — UTC-midnight instants then read as the previous local day.
 */
function simulateWestOfUtcLocalGetters() {
  const westOf = (d: Date) => new Date(d.getTime() - 5 * 3_600_000)
  jest.spyOn(Date.prototype, "getFullYear").mockImplementation(function (this: Date) { return westOf(this).getUTCFullYear() })
  jest.spyOn(Date.prototype, "getMonth").mockImplementation(function (this: Date) { return westOf(this).getUTCMonth() })
  jest.spyOn(Date.prototype, "getDate").mockImplementation(function (this: Date) { return westOf(this).getUTCDate() })
}

type ElementLike ={ type?: unknown; props?: { children?: unknown; [k: string]: unknown } }

/** Depth-first search of a React element tree for the first element matching `pred`. */
function findElement(node: unknown, pred: (e: ElementLike) => boolean): ElementLike & { props: Record<string, any> } {
  const walk = (n: unknown): ElementLike | null => {
    if (!n || typeof n !== "object") return null
    if (Array.isArray(n)) {
      for (const child of n) {
        const hit = walk(child)
        if (hit) return hit
      }
      return null
    }
    const el = n as ElementLike
    if (pred(el)) return el
    return walk(el.props?.children)
  }
  const hit = walk(node)
  if (!hit) throw new Error("element not found")
  return hit as ElementLike & { props: Record<string, any> }
}
