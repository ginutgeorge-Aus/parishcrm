import { render } from "@testing-library/react"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))
jest.mock("@/lib/attendanceQueries", () => ({
  getHeadcountRows: jest.fn(),
  getAllServiceTypes: jest.fn(),
}))
jest.mock("@/lib/dates", () => ({ sydneyTodayYMD: jest.fn(() => "2026-11-12") }))
jest.mock("@/components/attendance/TrendsClient", () => ({
  TrendsClient: (p: Record<string, unknown>) => <div data-testid="trends" data-props={JSON.stringify(p)} />,
}))

import { auth } from "@/auth"
import { getAllServiceTypes, getHeadcountRows } from "@/lib/attendanceQueries"
import TrendsPage from "../page"

const as = (role: string | undefined) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)
const props = (c: HTMLElement) => JSON.parse(c.querySelector("[data-testid=trends]")!.getAttribute("data-props")!)
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) })

beforeEach(() => {
  jest.clearAllMocks()
  ;(getAllServiceTypes as jest.Mock).mockResolvedValue([{ id: 1, name: "Sunday" }, { id: 2, name: "Evening" }])
  ;(getHeadcountRows as jest.Mock).mockResolvedValue([
    { date: "2026-11-08", serviceTypeId: 1, adults: 50, children: 10 },
    { date: "2026-11-08", serviceTypeId: 2, adults: 5, children: 1 },
  ])
})

describe("/attendance/trends page", () => {
  it.each(["ADMIN", "PASTOR", "OFFICE_ADMIN", "VIEWER"])("%s is allowed", async (role) => {
    as(role)
    const { container } = render(await TrendsPage(sp()))
    expect(container.querySelector("[data-testid=trends]")).not.toBeNull()
  })

  it.each(["AUDITOR", "EVENT_ORGANISER"])("redirects %s to /", async (role) => {
    as(role)
    await expect(TrendsPage(sp())).rejects.toThrow("REDIRECT:/")
    expect(getHeadcountRows).not.toHaveBeenCalled()
  })

  it("redirects a role-less session to login", async () => {
    as(undefined)
    await expect(TrendsPage(sp())).rejects.toThrow("REDIRECT:/login")
  })

  it("defaults to weekly, last 26 weeks, all services combined", async () => {
    as("VIEWER")
    const { container } = render(await TrendsPage(sp()))
    expect(getHeadcountRows).toHaveBeenCalledWith("2026-05-18", "2026-11-12")
    const p = props(container)
    expect(p.view).toBe("weekly")
    expect(p.typeId).toBeNull()
    expect(p.points).toHaveLength(26)
    expect(p.points.at(-1)).toMatchObject({ key: "2026-11-09", adults: null, children: null }) // current week, nothing yet: a gap
    expect(p.points.at(-2)).toMatchObject({ key: "2026-11-02", adults: 55, children: 11 })
  })

  it("monthly view covers the last 12 months", async () => {
    as("VIEWER")
    const { container } = render(await TrendsPage(sp({ view: "monthly" })))
    expect(getHeadcountRows).toHaveBeenCalledWith("2025-12-01", "2026-11-12")
    const p = props(container)
    expect(p.points).toHaveLength(12)
    expect(p.points.at(-1)).toMatchObject({ key: "2026-11", adults: 55 })
  })

  it("filters by a known service type and ignores an unknown one", async () => {
    as("VIEWER")
    let c = render(await TrendsPage(sp({ type: "2" }))).container
    expect(props(c).typeId).toBe(2)
    expect(props(c).points.at(-2)).toMatchObject({ adults: 5 })
    c = render(await TrendsPage(sp({ type: "99" }))).container
    expect(props(c).typeId).toBeNull()
  })

  it("year view compares this year with last, by month by default", async () => {
    as("VIEWER")
    const { container } = render(await TrendsPage(sp({ view: "year" })))
    expect(getHeadcountRows).toHaveBeenCalledWith("2024-12-25", "2026-11-12")
    const p = props(container)
    expect(p.year).toBe(2026)
    expect(p.granularity).toBe("month")
    expect(p.yoy).toHaveLength(12)
    expect(p.yoy[10]).toEqual({ period: 11, thisYear: 66, lastYear: null })
  })

  it("falls back to weekly for an unknown view", async () => {
    as("VIEWER")
    const { container } = render(await TrendsPage(sp({ view: "bogus" })))
    expect(props(container).view).toBe("weekly")
  })
})
