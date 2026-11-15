/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { NextRequest } from "next/server"
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { sundaySchoolClass: { findUnique: jest.fn() } } }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/featureFlags", () => ({ featureNotFound: jest.fn(() => Promise.resolve(null)) }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { GET } from "../route"

const call = (id = "3") => GET(new NextRequest(`http://localhost/api/sunday-school/${id}/roster`), { params: Promise.resolve({ id }) })
const as = (role: UserRole) => (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })

beforeEach(() => {
  jest.clearAllMocks()
  ;(rateLimit as jest.Mock).mockReturnValue(true)
  ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue({
    name: "Kindy", level: 0, location: "", year: 2026,
    enrolments: [{ person: { firstName: "=Ava", lastName: "Smith", family: { name: "Smith" } } }],
  })
})

describe("GET /api/sunday-school/[id]/roster", () => {
  it("401 without a session", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })
  it.each([UserRole.TEACHER, UserRole.EVENT_ORGANISER])("403 for %s", async (role) => {
    as(role)
    expect((await call()).status).toBe(403)
    expect(prisma.sundaySchoolClass.findUnique).not.toHaveBeenCalled()
  })
  it("404 for a bad id or missing class, 429 when throttled", async () => {
    as(UserRole.VIEWER)
    expect((await call("abc")).status).toBe(404)
    ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValueOnce(null)
    expect((await call()).status).toBe(404)
    ;(rateLimit as jest.Mock).mockReturnValue(false)
    expect((await call()).status).toBe(429)
  })
  it.each([UserRole.VIEWER, UserRole.HEADMASTER, UserRole.ADMIN])("%s gets a guarded CSV and an audit row", async (role) => {
    as(role)
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    expect(res.headers.get("content-disposition")).toContain("sunday-school-kindy-2026.csv")
    expect(await res.text()).toBe("Student,Family,Class,Level,Location,Year\r\n'=Ava Smith,Smith,Kindy,0,,2026\r\n")
    expect(logAudit).toHaveBeenCalledWith(1, "SS_ROSTER_EXPORTED", "SundaySchoolClass", 3, { count: 1 }, undefined)
  })
})
