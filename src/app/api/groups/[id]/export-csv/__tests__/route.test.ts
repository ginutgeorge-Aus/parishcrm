/** @jest-environment node */
import { NextRequest } from "next/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { group: { findUnique: jest.fn() }, groupMember: { findMany: jest.fn() } } }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("server-only", () => ({}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/dates", () => ({ ...jest.requireActual("@/lib/dates"), sydneyTodayYMD: () => "2026-11-11" }))

import { GET } from "@/app/api/groups/[id]/export-csv/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"

const p = prisma as unknown as { group: { findUnique: jest.Mock }; groupMember: { findMany: jest.Mock } }
const call = (id = "4") => GET(new NextRequest(`http://localhost/api/groups/${id}/export-csv`), { params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "9", role: "VIEWER" } })
  p.group.findUnique.mockResolvedValue({ name: "Youth & Choir" })
  p.groupMember.findMany.mockResolvedValue([
    {
      role: "MEMBER", title: "=HYPERLINK(\"x\")", joinedAt: new Date("2026-11-01T00:00:00Z"),
      person: { firstName: "Jo", lastName: "Doe", email: "enc:jo@example.com", mobile: null, family: { name: "Doe" } },
    },
  ])
})

it.each(["AUDITOR", "EVENT_ORGANISER"])("forbids %s", async (role) => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "9", role } })
  expect((await call()).status).toBe(403)
  expect(p.groupMember.findMany).not.toHaveBeenCalled()
})

it("401s without a session and 404s a missing group or bad id", async () => {
  ;(auth as jest.Mock).mockResolvedValueOnce(null)
  expect((await call()).status).toBe(401)
  expect((await call("x")).status).toBe(404)
  p.group.findUnique.mockResolvedValueOnce(null)
  expect((await call()).status).toBe(404)
})

it("exports escaped, decrypted rows and audits the export", async () => {
  const res = await call()
  expect(res.status).toBe(200)
  expect(res.headers.get("Content-Disposition")).toContain("group-youth-choir-2026-11-11.csv")
  const lines = (await res.text()).split("\n")
  expect(lines[0]).toBe("Surname,Given name,Family,Role,Title,Joined,Email,Mobile")
  expect(lines[1]).toBe(`Doe,Jo,Doe,Member,"'=HYPERLINK(""x"")",2026-11-01,jo@example.com,`)
  expect(logAudit).toHaveBeenCalledWith(9, "GROUP_MEMBERS_EXPORTED", "Group", 4, { rowCount: 1 }, undefined)
})
