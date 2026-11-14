/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ featureNotFound: jest.fn(async () => null) }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn(async () => ({ name: "Test Church" })) }))
jest.mock("@/lib/prisma", () => ({ prisma: { sundaySchoolClass: { findFirst: jest.fn() } } }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GET } from "@/app/api/sunday-school/[id]/badges/route"

const find = (prisma as unknown as { sundaySchoolClass: { findFirst: jest.Mock } }).sundaySchoolClass.findFirst
const call = (id = "4") => GET(new Request("http://x"), { params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  find.mockResolvedValue({
    name: "Grade 1", year: 2026,
    enrolments: [{ person: { id: 3, firstName: "Ann", lastName: "Lee" } }, { person: { id: 4, firstName: "Bo", lastName: "Kim" } }],
  })
})

describe("GET /api/sunday-school/[id]/badges", () => {
  it("401 when signed out", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })
  it.each([UserRole.VIEWER, UserRole.TEACHER, UserRole.EVENT_ORGANISER])("403 for %s", async (role) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
    expect((await call()).status).toBe(403)
    expect(find).not.toHaveBeenCalled()
  })
  it("404 for a bad id or missing class", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: UserRole.ADMIN } })
    expect((await call("abc")).status).toBe(404)
    find.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })
  it("returns a PDF for a manager, scoped to the class", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: UserRole.HEADMASTER } })
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/pdf")
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF")
    expect(find.mock.calls[0][0].where).toEqual({ id: 4, archivedAt: null })
  })
})
