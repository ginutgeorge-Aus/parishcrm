/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    sundaySchoolClass: { findUnique: jest.fn() },
    sundaySchoolRollMarker: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/sundaySchoolAccess", () => ({ canMarkRoll: jest.fn() }))
jest.mock("@/lib/sundaySchoolRoll", () => ({ loadRoll: jest.fn() }))
jest.mock("@/lib/dates", () => ({ sydneyTodayYMD: () => "2026-10-11" }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))
jest.mock("@/components/sunday-school/RollList", () => ({
  RollList: (p: { readOnly: boolean; date: string; dateHrefBase: string }) =>
    <div data-testid="roll" data-readonly={String(p.readOnly)} data-date={p.date} data-base={p.dateHrefBase} />,
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canMarkRoll } from "@/lib/sundaySchoolAccess"
import { loadRoll } from "@/lib/sundaySchoolRoll"
import ClassRollPage from "@/app/(dashboard)/sunday-school/[id]/roll/page"
import OrganiserRollPage from "@/app/(organiser)/my-classes/[id]/roll/page"
import MyClassesPage from "@/app/(organiser)/my-classes/page"

const as = (role: string) => (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
const props = (date?: string | string[]) => ({ params: Promise.resolve({ id: "4" }), searchParams: Promise.resolve(date === undefined ? {} : { date }) })
const staff = async (date?: string | string[]) => renderToStaticMarkup(await ClassRollPage(props(date)))
const organiser = async (date?: string | string[]) => renderToStaticMarkup(await OrganiserRollPage(props(date)))
const roll = (archived = false) => ({ cls: { id: 4, name: "Kindy", year: 2026, location: "", archived }, rows: [] })

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue({ year: 2026, name: "Kindy" })
  ;(loadRoll as jest.Mock).mockResolvedValue(roll())
})

describe("/sunday-school/[id]/roll", () => {
  it("redirects an AUDITOR home", async () => {
    as("AUDITOR")
    await expect(staff()).rejects.toThrow("REDIRECT /")
  })
  it("is read-only for a VIEWER", async () => {
    as("VIEWER")
    ;(canMarkRoll as jest.Mock).mockResolvedValue(false)
    expect(await staff()).toContain('data-readonly="true"')
  })
  it("lets an ADMIN mark, defaulting to today", async () => {
    as("ADMIN")
    ;(canMarkRoll as jest.Mock).mockResolvedValue(true)
    const html = await staff()
    expect(html).toContain('data-readonly="false"')
    expect(html).toContain('data-date="2026-10-11"')
    expect(loadRoll).toHaveBeenCalledWith(4, "2026-10-11")
  })
  it("archived class is read-only even for an ADMIN", async () => {
    as("ADMIN")
    ;(canMarkRoll as jest.Mock).mockResolvedValue(true)
    ;(loadRoll as jest.Mock).mockResolvedValue(roll(true))
    expect(await staff()).toContain('data-readonly="true"')
  })
  it("shows the date error instead of the roll", async () => {
    as("ADMIN")
    ;(canMarkRoll as jest.Mock).mockResolvedValue(true)
    const html = await staff("2026-12-25")
    expect(html).toContain("Can&#x27;t take a roll for a future date")
    expect(loadRoll).not.toHaveBeenCalled()
  })
  it("ignores a repeated ?date=", async () => {
    as("ADMIN")
    ;(canMarkRoll as jest.Mock).mockResolvedValue(true)
    expect(await staff(["2026-10-04", "2026-10-05"])).toContain('data-date="2026-10-11"')
  })
  it("opens a past year's class on its last day", async () => {
    as("ADMIN")
    ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue({ year: 2025, name: "Kindy" })
    await expect(staff()).rejects.toThrow("REDIRECT /sunday-school/4/roll?date=2025-12-31")
  })
})

describe("/my-classes/[id]/roll", () => {
  it("404s a class the organiser is not assigned to", async () => {
    as("EVENT_ORGANISER")
    ;(canMarkRoll as jest.Mock).mockResolvedValue(false)
    await expect(organiser()).rejects.toThrow("NOT_FOUND")
    expect(canMarkRoll).toHaveBeenCalledWith(1, 4, "EVENT_ORGANISER")
    expect(loadRoll).not.toHaveBeenCalled()
  })
  it("lets an assigned organiser mark", async () => {
    as("EVENT_ORGANISER")
    ;(canMarkRoll as jest.Mock).mockResolvedValue(true)
    const html = await organiser()
    expect(html).toContain('data-readonly="false"')
    expect(html).toContain('data-base="/my-classes/4/roll"')
  })
})

describe("/my-classes", () => {
  it("lists only this login's live classes", async () => {
    as("EVENT_ORGANISER")
    ;(prisma.sundaySchoolRollMarker.findMany as jest.Mock).mockResolvedValue([{ class: { id: 4, name: "Kindy", year: 2026, location: "Hall" } }])
    const html = renderToStaticMarkup(await MyClassesPage())
    expect(html).toContain('href="/my-classes/4/roll"')
    expect((prisma.sundaySchoolRollMarker.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ userId: 1, class: { archivedAt: null } })
  })
})
