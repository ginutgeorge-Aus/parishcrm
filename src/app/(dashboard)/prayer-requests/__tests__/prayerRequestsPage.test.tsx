import { render } from "@testing-library/react"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))
jest.mock("@/lib/actions/prayerRequest", () => ({ listPrayerRequests: jest.fn() }))
jest.mock("@/components/pastoral/PrayerRequestList", () => ({
  PrayerRequestList: (p: { requests: unknown[] }) => <div data-testid="list">{`requests:${p.requests.length}`}</div>,
}))
jest.mock("@/components/pastoral/PrayerRequestForm", () => ({ PrayerRequestForm: () => <div data-testid="form" /> }))

import { auth } from "@/auth"
import { listPrayerRequests } from "@/lib/actions/prayerRequest"
import PrayerRequestsPage from "../page"

const as = (role: string | undefined) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)
const run = async (sp: Record<string, string> = {}) =>
  render(await PrayerRequestsPage({ searchParams: Promise.resolve(sp) }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(listPrayerRequests as jest.Mock).mockResolvedValue({ requests: [{ id: 1 }, { id: 2 }] })
})

describe("/prayer-requests page", () => {
  it.each(["ADMIN", "PASTOR"])("%s sees the active list and the form", async (role) => {
    as(role)
    const { getByTestId } = await run()
    expect(getByTestId("list")).toHaveTextContent("requests:2")
    expect(getByTestId("form")).toBeInTheDocument()
    expect(listPrayerRequests).toHaveBeenCalledWith(["ACTIVE"])
  })

  it.each(["OFFICE_ADMIN", "VIEWER", "AUDITOR", "EVENT_ORGANISER", "TEACHER"])(
    "redirects %s home before reading any request",
    async (role) => {
      as(role)
      await expect(run()).rejects.toThrow("REDIRECT:/")
      expect(listPrayerRequests).not.toHaveBeenCalled()
    },
  )

  it("redirects a signed-out visitor to login", async () => {
    as(undefined)
    await expect(run()).rejects.toThrow("REDIRECT:/login")
  })

  it.each([
    ["answered", ["ANSWERED"]],
    ["archived", ["ARCHIVED"]],
    ["bogus", ["ACTIVE"]],
  ])("status=%s reads %j", async (status, want) => {
    as("PASTOR")
    await run({ status })
    expect(listPrayerRequests).toHaveBeenCalledWith(want)
  })
})
