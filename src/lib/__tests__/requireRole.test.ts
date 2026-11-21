import { UserRole } from "@/lib/generated/prisma/enums"
import { auth } from "@/auth"
import { requireRole } from "../requireRole"
import { canEdit, canAccessAccounting } from "../roleGuard"

jest.mock("@/auth", () => ({ auth: jest.fn() }))

const mockAuth = auth as unknown as jest.Mock

function session(role: UserRole | undefined, id: string | undefined = "7") {
  return { user: { id, role }, expires: "2099-01-01" }
}

beforeEach(() => mockAuth.mockReset())

describe("requireRole", () => {
  it.each([UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN])(
    "returns session and actor for %s when predicate allows",
    async (role) => {
      const s = session(role)
      mockAuth.mockResolvedValue(s)
      const result = await requireRole(canEdit)
      expect(result).toEqual({ session: s, actor: 7 })
    },
  )

  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER])(
    "returns Unauthorized for %s when predicate denies",
    async (role) => {
      mockAuth.mockResolvedValue(session(role))
      expect(await requireRole(canEdit)).toEqual({ error: "Unauthorized" })
    },
  )

  it("denies a null session", async () => {
    mockAuth.mockResolvedValue(null)
    expect(await requireRole(canEdit)).toEqual({ error: "Unauthorized" })
  })

  it("denies a role-less session", async () => {
    mockAuth.mockResolvedValue(session(undefined))
    expect(await requireRole(canEdit)).toEqual({ error: "Unauthorized" })
  })

  it("applies the given predicate, not a fixed one", async () => {
    mockAuth.mockResolvedValue(session(UserRole.OFFICE_ADMIN))
    expect(await requireRole(canAccessAccounting)).toEqual({ error: "Unauthorized" })
  })

  it("throws when an allowed session has no valid id", async () => {
    mockAuth.mockResolvedValue(session(UserRole.ADMIN, ""))
    await expect(requireRole(canEdit)).rejects.toThrow("missing a valid user id")
  })

  it("derives the actor from the session id, not a fixed value", async () => {
    const s = session(UserRole.PASTOR, "42")
    mockAuth.mockResolvedValue(s)
    expect(await requireRole(canEdit)).toEqual({ session: s, actor: 42 })
  })

  it.each(["abc", "0", "-3", "7abc", "7.5"])("throws for invalid id %s", async (id) => {
    mockAuth.mockResolvedValue(session(UserRole.ADMIN, id))
    await expect(requireRole(canEdit)).rejects.toThrow("missing a valid user id")
  })

  it("denies a session with no user", async () => {
    mockAuth.mockResolvedValue({ expires: "2099-01-01" })
    expect(await requireRole(canEdit)).toEqual({ error: "Unauthorized" })
  })

  it("does not read the id of a denied session", async () => {
    mockAuth.mockResolvedValue(session(UserRole.VIEWER, ""))
    expect(await requireRole(canEdit)).toEqual({ error: "Unauthorized" })
  })
})
