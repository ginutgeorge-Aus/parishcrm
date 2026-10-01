/** @jest-environment node */

import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: jest.fn() },
    auditLog: { groupBy: jest.fn() },
  },
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/users/DeleteUserButton", () => ({ DeleteUserButton: () => null }))
jest.mock("@/components/users/UnlockUserButton", () => ({ UnlockUserButton: () => null }))
jest.mock("@/components/users/ResetTotpButton", () => ({ ResetTotpButton: () => "RESET_TOTP_BTN" }))
jest.mock("@/components/users/ResendWelcomeButton", () => ({ ResendWelcomeButton: () => null }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import UsersPage from "@/app/(dashboard)/users/page"

const mockAuth = auth as jest.Mock
const mockUsers = prisma.user.findMany as jest.Mock
const mockGroupBy = prisma.auditLog.groupBy as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe("UsersPage", () => {
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(UsersPage()).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("queries last login from USER_LOGIN audit events", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUsers.mockResolvedValue([])
    mockGroupBy.mockResolvedValue([])
    await UsersPage()
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["userId"],
        where: { action: "USER_LOGIN" },
        _max: { createdAt: true },
      })
    )
  })

  it("renders a last-login column with date or Never fallback", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUsers.mockResolvedValue([
      { id: 1, name: "Alice", email: "a@x.com", role: "ADMIN", lockedUntil: null, otpLockedUntil: null },
      { id: 2, name: "Bob", email: "b@x.com", role: "VIEWER", lockedUntil: null, otpLockedUntil: null },
    ])
    mockGroupBy.mockResolvedValue([
      { userId: 1, _max: { createdAt: new Date("2026-06-20T03:30:00.000Z") } },
    ])
    const html = renderToStaticMarkup(await UsersPage())
    expect(html).toContain("Last login")
    expect(html).toContain("Never") // Bob has no login
    expect(html).toContain("2026") // Alice's login year rendered
  })

  it("shows Locked badge when otpLockedUntil is in the future", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUsers.mockResolvedValue([
      { id: 1, name: "Alice", email: "a@x.com", role: "ADMIN", lockedUntil: null, otpLockedUntil: new Date(Date.now() + 60_000) },
    ])
    mockGroupBy.mockResolvedValue([])
    const html = renderToStaticMarkup(await UsersPage())
    expect(html).toContain("Locked")
  })

  it("shows the TOTP reset button only for roles the viewer can act on", async () => {
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN", id: "1" } })
    const base = { lockedUntil: null, otpLockedUntil: null, totpEnabledAt: new Date("2026-09-01") }
    mockUsers.mockResolvedValue([
      { id: 2, name: "Pat", email: "pastor@example.com", role: "PASTOR", ...base },
    ])
    mockGroupBy.mockResolvedValue([])
    expect(renderToStaticMarkup(await UsersPage())).not.toContain("RESET_TOTP_BTN")

    mockUsers.mockResolvedValue([
      { id: 3, name: "Vic", email: "viewer@example.com", role: "VIEWER", ...base },
    ])
    expect(renderToStaticMarkup(await UsersPage())).toContain("RESET_TOTP_BTN")
  })
})
