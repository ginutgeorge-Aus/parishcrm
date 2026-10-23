/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: { findMany: jest.fn() },
    appSetting: { findUnique: jest.fn() },
    paymentAccount: { findMany: jest.fn() },
    person: { findMany: jest.fn(), count: jest.fn() },
    family: { count: jest.fn(), findMany: jest.fn() },
    pettyCashSession: { count: jest.fn() },
    event: { count: jest.fn() },
    registration: { findMany: jest.fn() },
    transaction: { aggregate: jest.fn(), groupBy: jest.fn() },
    auditLog: { findMany: jest.fn() },
    familyUpdateSubmission: { count: jest.fn() },
    membershipApplication: { count: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/dashboard/BirthdayWidget", () => ({ BirthdayWidget: () => null }))
jest.mock("@/components/dashboard/MarriageAnniversaryWidget", () => ({ MarriageAnniversaryWidget: () => null }))
jest.mock("@/components/dashboard/AnniversaryWidget", () => ({ AnniversaryWidget: () => null }))
jest.mock("@/components/dashboard/WhatsNewFooter", () => ({ WhatsNewFooter: () => null }))
jest.mock("@/components/dashboard/SetupChecklist", () => ({ SetupChecklist: () => null }))
jest.mock("@/lib/featureFlags", () => ({ getEnabledFeatures: jest.fn() }))

import { renderToStaticMarkup } from "react-dom/server"
import { PERSON_FETCH_CAP } from "@/lib/constants"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import DashboardPage from "@/app/(dashboard)/page"
import { MarriageAnniversaryWidget } from "@/components/dashboard/MarriageAnniversaryWidget"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { resolveFeatures } from "@/lib/features"

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
  ;(prisma.transaction.groupBy as jest.Mock).mockResolvedValue([])
  ;(prisma.auditLog.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.familyUpdateSubmission.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.membershipApplication.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue(null)
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getEnabledFeatures as jest.Mock).mockResolvedValue(resolveFeatures({}))
})

describe("DashboardPage first-run feature prompt", () => {
  const OLD_DEMO = process.env.DEMO_MODE
  afterEach(() => { if (OLD_DEMO === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = OLD_DEMO })
  const pending = () => (prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ key: "features.onboarding", value: "pending" })

  it("sends an ADMIN with the pending flag to Settings → Features", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks(); pending()
    await expect(DashboardPage()).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/settings/features?welcome=1")
  })

  it.each(["PASTOR", "OFFICE_ADMIN", "VIEWER"])("never redirects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { role, id: "1" } })
    primeMocks(); pending()
    await DashboardPage()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("does not redirect without the flag", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("never prompts in the live demo", async () => {
    process.env.DEMO_MODE = "true"
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks(); pending()
    await DashboardPage()
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(prisma.appSetting.findUnique).not.toHaveBeenCalled()
  })
})

describe("DashboardPage feature toggles", () => {
  it("skips the queries and sections of off features", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    ;(getEnabledFeatures as jest.Mock).mockResolvedValue(
      resolveFeatures({ events: false, accounting: false, celebrations: false, familyUpdates: false, memberships: false }),
    )
    const html = renderToStaticMarkup(await DashboardPage())
    expect(prisma.event.count).not.toHaveBeenCalled()
    expect(prisma.transaction.aggregate).not.toHaveBeenCalled()
    expect(prisma.transaction.groupBy).not.toHaveBeenCalled()
    expect(prisma.pettyCashSession.count).not.toHaveBeenCalled()
    expect(mockPersonFindMany).not.toHaveBeenCalled()
    expect(prisma.familyUpdateSubmission.count).not.toHaveBeenCalled()
    expect(prisma.membershipApplication.count).not.toHaveBeenCalled()
    expect(html).not.toContain("Upcoming events")
    expect(html).not.toContain("money-heading")
    expect(html).not.toContain("people-heading")
    expect(html).toContain("Members")
  })
})

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

  it("bounds 'added (30 days)' and upcoming events by Sydney-day instants", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    expect(prisma.family.count as jest.Mock).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date("2026-01-29T13:00:00.000Z") }, archivedAt: null },
    })
    const eventWhere = (prisma.event.count as jest.Mock).mock.calls[0][0].where
    expect(eventWhere.OR[0].date).toEqual({
      gte: new Date("2026-02-28T13:00:00.000Z"),
      lte: new Date("2026-03-31T12:59:59.999Z"),
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

/** Calls to transaction.groupBy whose `by` matches `by` exactly. */
function groupByCalls(by: string[]) {
  return (prisma.transaction.groupBy as jest.Mock).mock.calls.filter((c) => JSON.stringify(c[0].by) === JSON.stringify(by))
}

/** Route groupBy results by query shape: per-account balances vs per-account unreconciled. */
function mockGroupBy({ balances = [], unreconciled = [] }: { balances?: unknown[]; unreconciled?: unknown[] }) {
  ;(prisma.transaction.groupBy as jest.Mock).mockImplementation((args: { by: string[] }) =>
    Promise.resolve(args.by.length === 1 ? unreconciled : balances),
  )
}

describe("DashboardPage account balances", () => {
  it("sums every account's income/expense (deactivated included) since its own asOfDate in one groupBy", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    const asOf1 = new Date("2026-01-01T00:00:00Z")
    const asOf2 = new Date("2026-03-01T00:00:00Z")
    ;(prisma.paymentAccount.findMany as jest.Mock).mockResolvedValue([
      { id: "a1", name: "Main Cheque", isActive: true },
      { id: "a2", name: "Old Savings", isActive: false }, // deactivated, with history: still shown
      { id: "a3", name: "No Opening Yet", isActive: true },
    ])
    ;(prisma.accountOpeningBalance.findMany as jest.Mock).mockResolvedValue([
      { paymentAccountId: "a1", amount: "100.00", asOfDate: asOf1 },
      { paymentAccountId: "a2", amount: "10.00", asOfDate: asOf2 },
    ])
    mockGroupBy({
      balances: [
        { paymentAccountId: "a1", type: "INCOME", _sum: { amount: "50.25" } },
        { paymentAccountId: "a1", type: "EXPENSE", _sum: { amount: "20.00" } },
        { paymentAccountId: "a2", type: "EXPENSE", _sum: { amount: "4.50" } },
      ],
    })
    const html = renderToStaticMarkup(await DashboardPage())

    const balanceCalls = groupByCalls(["paymentAccountId", "type"])
    expect(balanceCalls).toHaveLength(1)
    expect(balanceCalls[0][0]).toEqual({
      by: ["paymentAccountId", "type"],
      where: {
        type: { in: ["INCOME", "EXPENSE"] },
        OR: [
          { paymentAccountId: "a1", date: { gte: asOf1 } },
          { paymentAccountId: "a2", date: { gte: asOf2 } },
        ],
      },
      _sum: { amount: true },
    })
    // Only the two giving totals still use aggregate — no per-account queries.
    expect(prisma.transaction.aggregate).toHaveBeenCalledTimes(2)
    expect(html).toContain("$130.25")
    expect(html).toContain("$5.50")
    expect(html).toContain("Old Savings")
    expect((prisma.paymentAccount.findMany as jest.Mock).mock.calls[0][0]?.where ?? {}).not.toHaveProperty("isActive")
  })

  it("skips the balance groupBy when no account has an opening balance", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    ;(prisma.paymentAccount.findMany as jest.Mock).mockResolvedValue([{ id: "a1", name: "Main Cheque", isActive: true }])
    await DashboardPage()
    expect(groupByCalls(["paymentAccountId", "type"])).toHaveLength(0)
  })
})

describe("DashboardPage hierarchy and needs-attention list", () => {
  /** Render the dashboard for a role after priming the shared mocks; return its HTML. */
  async function renderAs(role: string, prime?: () => void) {
    mockAuth.mockResolvedValue({ user: { role, id: "1", name: "Sam Example" } })
    primeMocks()
    prime?.()
    return renderToStaticMarkup(await DashboardPage())
  }

  it("titles the page with a single h1 and leads with Needs attention", async () => {
    const html = await renderAs("ADMIN")
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(html).toContain("Welcome back, Sam")
    expect(html.indexOf("Needs attention")).toBeLessThan(html.indexOf("Money"))
    expect(html.indexOf("Needs attention")).toBeLessThan(html.indexOf("People"))
  })

  it("shows the calm all-caught-up state when nothing is pending", async () => {
    const html = await renderAs("ADMIN")
    expect(html).toContain("All caught up")
  })

  it("keeps the families/people breakdown on the 'Added (30 days)' stat", async () => {
    const html = await renderAs("ADMIN", () => {
      ;(prisma.family.count as jest.Mock).mockResolvedValue(2)
      ;(prisma.person.count as jest.Mock).mockResolvedValue(5)
    })
    expect(html).toContain("2 families · 5 people")
  })

  it("lists pending family updates, membership forms and unreconciled transactions with links", async () => {
    const html = await renderAs("ADMIN", () => {
      ;(prisma.familyUpdateSubmission.count as jest.Mock).mockResolvedValue(2)
      ;(prisma.membershipApplication.count as jest.Mock).mockResolvedValue(3)
      mockGroupBy({
        unreconciled: [
          { paymentAccountId: 7, _count: 4, _min: { date: new Date("2026-01-01T00:00:00Z") } },
          { paymentAccountId: 8, _count: 1, _min: { date: new Date("2025-06-01T00:00:00Z") } },
        ],
      })
    })
    expect(html).not.toContain("All caught up")
    expect(html).toContain("Family updates to review")
    expect(html).toContain('href="/families/updates"')
    expect(html).toContain("Membership applications to review")
    expect(html).toContain('href="/memberships?status=PENDING"')
    expect(html).toMatch(/>5<\/span><span[^>]*>Unreconciled transactions/)
    // Links the account with the most pending rows, from its oldest one.
    expect(html).toContain('href="/accounting/reconciliation?paymentAccount=7&amp;from=2026-01-01&amp;status=pending"')
    expect(prisma.membershipApplication.count).toHaveBeenCalledWith({ where: { status: "PENDING" } })
  })

  it("counts unreconciled rows the reconciliation page can show: any account, up to end of today", async () => {
    jest.useFakeTimers({ now: new Date("2026-03-10T01:00:00.000Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] })
    try {
      await renderAs("ADMIN")
    } finally {
      jest.useRealTimers()
    }
    const calls = groupByCalls(["paymentAccountId"])
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toEqual({
      by: ["paymentAccountId"],
      where: {
        reconciled: false,
        // CASH (petty-cash mirror) accounts are never reconciled.
        paymentAccountRel: { kind: "BANK" },
        // 01:00Z on 10 Mar = 12:00 on 10 Mar in Sydney.
        date: { lte: new Date("2026-03-10T23:59:59.999Z") },
      },
      _count: true,
      _min: { date: true },
    })
  })

  it("shows a capped birthday count as N+", async () => {
    jest.useFakeTimers({ now: new Date("2026-03-10T01:00:00.000Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] })
    let html: string
    try {
      html = await renderAs("ADMIN", () => {
        mockPersonFindMany.mockResolvedValue(
          Array.from({ length: PERSON_FETCH_CAP + 1 }, (_, i) => ({
            id: i + 1,
            firstName: "P",
            lastName: String(i),
            dateOfBirth: i === 0 ? "1990-03-11" : "1990-09-01",
            family: { name: "F" },
          })),
        )
      })
    } finally {
      jest.useRealTimers()
    }
    expect(html).toMatch(/>1\+<\/span><span[^>]*>Birthday in the next 7 days/)
  })

  it("does not query or show editor/accounting items for VIEWER", async () => {
    const html = await renderAs("VIEWER")
    expect(prisma.membershipApplication.count).not.toHaveBeenCalled()
    expect(prisma.pettyCashSession.count).not.toHaveBeenCalled()
    expect(prisma.transaction.groupBy).not.toHaveBeenCalled()
    expect(html).not.toContain("Money")
    expect(html).toContain("All caught up")
  })

  it("keeps AUDITOR off people queries, editor queues and the accounting to-do rows", async () => {
    const html = await renderAs("AUDITOR")
    expect(prisma.membershipApplication.count).not.toHaveBeenCalled()
    expect(prisma.person.findMany).not.toHaveBeenCalled()
    expect(prisma.family.findMany).not.toHaveBeenCalled()
    expect(prisma.family.count).not.toHaveBeenCalled()
    expect(prisma.person.count).not.toHaveBeenCalled()
    expect(prisma.pettyCashSession.count).not.toHaveBeenCalled()
    expect(groupByCalls(["paymentAccountId"])).toHaveLength(0)
    expect(html).not.toContain(">Members<")
    expect(html).toContain("Upcoming events (30 days)")
    expect(html).toContain("Giving this month")
    // Nothing an auditor can act on: no section rather than "All caught up".
    expect(html).not.toContain("Needs attention")
    expect(html).not.toContain("All caught up")
  })

  it("links the upcoming-events figure to /events", async () => {
    const html = await renderAs("VIEWER")
    expect(html).toMatch(/<a[^>]*href="\/events"[^>]*>Upcoming events \(30 days\)<\/a>/)
  })

  it("keeps OFFICE_ADMIN off the accounting to-do rows", async () => {
    await renderAs("OFFICE_ADMIN")
    expect(prisma.pettyCashSession.count).not.toHaveBeenCalled()
    expect(groupByCalls(["paymentAccountId"])).toHaveLength(0)
  })

  it("renders balances as tinted tiles with +/− markers, not side stripes", async () => {
    const html = await renderAs("ADMIN", () => {
      ;(prisma.paymentAccount.findMany as jest.Mock).mockResolvedValue([
        { id: 1, name: "Main Cheque", isActive: true },
        { id: 2, name: "Overdrawn", isActive: true },
      ])
      ;(prisma.accountOpeningBalance.findMany as jest.Mock).mockResolvedValue([
        { paymentAccountId: 1, amount: "100.00", asOfDate: new Date("2026-01-01T00:00:00Z") },
        { paymentAccountId: 2, amount: "-5.00", asOfDate: new Date("2026-01-01T00:00:00Z") },
      ])
    })
    expect(html).not.toMatch(/border-l-4/)
    expect(html).toContain("bg-income/10")
    expect(html).toContain("+$100.00")
    expect(html).toContain("bg-expense/10")
    expect(html).toContain("−$5.00")
  })
})

describe("DashboardPage giving vs last year", () => {
  /** Render the page with this-month and last-year giving sums; return its text. */
  async function renderGiving(now: string, lastYear: string) {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    ;(prisma.transaction.aggregate as jest.Mock)
      .mockResolvedValueOnce({ _sum: { amount: now } })
      .mockResolvedValueOnce({ _sum: { amount: lastYear } })
    return renderToStaticMarkup(await DashboardPage())
  }

  it("shows a neutral 'no change' (no arrow, no income/expense colour) when the delta is 0", async () => {
    const html = await renderGiving("0", "0")
    expect(html).toContain("No change")
    expect(html).not.toMatch(/[▲▼]/)
    expect(html).not.toMatch(/text-income|text-expense/)
  })

  it("shows a green up arrow with sr-only text when giving is up", async () => {
    const html = await renderGiving("150.00", "100.00")
    expect(html).toContain("▲")
    expect(html).toContain("text-income")
    expect(html).toMatch(/<span class="sr-only">Up<\/span>/)
  })

  it("shows a red down arrow with sr-only text when giving is down", async () => {
    const html = await renderGiving("50.00", "100.00")
    expect(html).toContain("▼")
    expect(html).toContain("text-expense")
    expect(html).toMatch(/<span class="sr-only">Down<\/span>/)
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
