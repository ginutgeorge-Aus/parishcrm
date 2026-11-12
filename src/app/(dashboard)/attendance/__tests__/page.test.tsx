import { render } from "@testing-library/react"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))
jest.mock("@/lib/attendanceQueries", () => ({
  getActiveServiceTypes: jest.fn(),
  getRecentHeadcounts: jest.fn(),
}))
jest.mock("@/lib/dates", () => ({ sydneyTodayYMD: jest.fn(() => "2026-11-12") }))
jest.mock("@/components/attendance/HeadcountForm", () => ({
  HeadcountForm: (p: { serviceTypes: unknown[]; rows: unknown[]; today: string }) => (
    <div data-testid="form">{`types:${p.serviceTypes.length} rows:${p.rows.length} today:${p.today}`}</div>
  ),
}))

import { auth } from "@/auth"
import { getActiveServiceTypes, getRecentHeadcounts } from "@/lib/attendanceQueries"
import AttendancePage from "../page"

const as = (role: string | undefined) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)

beforeEach(() => {
  jest.clearAllMocks()
  ;(getActiveServiceTypes as jest.Mock).mockResolvedValue([{ id: 1, name: "Sunday" }])
  ;(getRecentHeadcounts as jest.Mock).mockResolvedValue([])
})

describe("/attendance page", () => {
  it.each(["ADMIN", "PASTOR", "OFFICE_ADMIN"])("%s sees the form", async (role) => {
    as(role)
    const { getByTestId } = render(await AttendancePage())
    expect(getByTestId("form")).toHaveTextContent("types:1 rows:0 today:2026-11-12")
  })

  it("redirects a VIEWER to trends", async () => {
    as("VIEWER")
    await expect(AttendancePage()).rejects.toThrow("REDIRECT:/attendance/trends")
    expect(getRecentHeadcounts).not.toHaveBeenCalled()
  })

  it.each(["AUDITOR", "EVENT_ORGANISER"])("redirects %s to /", async (role) => {
    as(role)
    await expect(AttendancePage()).rejects.toThrow("REDIRECT:/")
    expect(getActiveServiceTypes).not.toHaveBeenCalled()
  })

  it("redirects a role-less session to login", async () => {
    as(undefined)
    await expect(AttendancePage()).rejects.toThrow("REDIRECT:/login")
  })
})
