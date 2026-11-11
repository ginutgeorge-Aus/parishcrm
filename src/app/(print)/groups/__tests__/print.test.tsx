/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
jest.mock("next/headers", () => ({ headers: jest.fn() }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({ prisma: { group: { findUnique: jest.fn() } } }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn() }))
jest.mock("@/lib/groupMembers", () => ({ loadMemberExportRows: jest.fn() }))
jest.mock("@/components/ui/PrintButton", () => ({ PrintButton: () => <button>PrintStub</button> }))

import GroupPrintPage from "@/app/(print)/groups/[id]/print/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { getChurchSettings } from "@/lib/churchSettings"
import { loadMemberExportRows } from "@/lib/groupMembers"
import { headers } from "next/headers"

const findUnique = prisma.group.findUnique as unknown as jest.Mock
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const as = (role?: string) => (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)

beforeEach(() => {
  jest.clearAllMocks()
  as("ADMIN")
  findUnique.mockResolvedValue({ id: 4, name: "Choir", category: "MINISTRY" })
  ;(getChurchSettings as jest.Mock).mockResolvedValue({ name: "Test Church" })
  ;(headers as jest.Mock).mockResolvedValue(new Headers({ "x-nonce": "abc" }))
  ;(loadMemberExportRows as jest.Mock).mockResolvedValue([
    { firstName: "Jo", lastName: "Doe", familyName: "Doe", role: "LEADER", title: "Chair", email: "jo@example.com", mobile: "0400" },
  ])
})

describe("/groups/[id]/print", () => {
  it("redirects anonymous and non-viewers, 404s bad id and missing group", async () => {
    as()
    await expect(GroupPrintPage(params("4"))).rejects.toThrow("NEXT_REDIRECT /login")
    as("EVENT_ORGANISER")
    await expect(GroupPrintPage(params("4"))).rejects.toThrow("NEXT_REDIRECT /")
    as("ADMIN")
    await expect(GroupPrintPage(params("x"))).rejects.toThrow("NEXT_NOT_FOUND")
    findUnique.mockResolvedValue(null)
    await expect(GroupPrintPage(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("prints the roster with contact details and writes an audit row", async () => {
    const html = renderToStaticMarkup(await GroupPrintPage(params("4")))
    expect(html).toContain("Test Church")
    expect(html).toContain("Choir")
    expect(html).toContain("Jo Doe")
    expect(html).toContain("jo@example.com")
    expect(html).toContain("1 member ")
    expect(html).toContain('nonce="abc"')
    expect(logAudit).toHaveBeenCalledWith(1, "GROUP_MEMBERS_PRINTED", "Group", 4, { rowCount: 1 }, undefined)
  })

  it("shows the empty notice", async () => {
    ;(loadMemberExportRows as jest.Mock).mockResolvedValue([])
    const html = renderToStaticMarkup(await GroupPrintPage(params("4")))
    expect(html).toContain("No members.")
    expect(html).toContain("0 members")
  })
})
