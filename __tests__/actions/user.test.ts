/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    trustedDevice: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  },
  // user.ts now re-imports `Prisma` from this module instead of the generated
  // client directly — the isolation-level enum value must still resolve.
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("bcryptjs", () => ({ hash: jest.fn().mockResolvedValue("hashed-pw") }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/email", () => ({ sendWelcomeEmail: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { hash } from "bcryptjs"
import { logAudit } from "@/lib/audit"
import { sendWelcomeEmail } from "@/lib/email"
import { createUser, updateUser, deleteUser, unlockUser, resendWelcome } from "@/lib/actions/user"

const mockSession = auth as jest.Mock
const mockFindUnique = prisma.user.findUnique as jest.Mock
const mockFindFirst = prisma.user.findFirst as jest.Mock
const mockCreate = prisma.user.create as jest.Mock
const mockUpdate = prisma.user.update as jest.Mock
const mockDelete = prisma.user.delete as jest.Mock
const mockCount = prisma.user.count as jest.Mock
const mockTransaction = prisma.$transaction as jest.Mock
const mockRevalidate = revalidatePath as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock
const mockHash = hash as jest.Mock
const mockLogAudit = logAudit as jest.Mock

function fd(fields: Record<string, string>) {
  const f = new FormData()
  Object.entries(fields).forEach(([k, v]) => f.set(k, v))
  return f
}

const validNewUser = { name: "Jane Smith", email: "jane@example.com", password: "Secret1!", role: "VIEWER" }

// updateUser/deleteUser run the last-admin recount + write inside a single
// prisma.$transaction — the default mock runs the callback against
// the same mocked `prisma` object, so tx.user.count/update/delete resolve to
// the same jest.fn()s as before and existing assertions keep working.
function resetMocks() {
  jest.clearAllMocks()
  mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
}

beforeEach(() => resetMocks())

// --- createUser ---
describe("createUser", () => {
  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await createUser(undefined, fd(validNewUser))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await createUser(undefined, fd(validNewUser))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await createUser(undefined, fd(validNewUser))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error for invalid role (invite flow — validates schema)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await createUser(undefined, fd({ name: "X", email: "jane@example.com", role: "UNKNOWN" }))
    expect(result?.error).toBeDefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("returns error for duplicate email", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 10, email: "jane@example.com" })
    const result = await createUser(undefined, fd(validNewUser))
    expect(result).toEqual({ error: "Email already in use" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  // --- P2002 unique-email race backstop: the pre-check findUnique
  // above is check-then-act too — a concurrent create can slip in between the
  // check and this create() call, so the create itself must also catch the
  // unique-constraint violation instead of throwing an unhandled 500.
  it("returns a clean error when create() hits a concurrent email P2002", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null) // pre-check saw the email as free
    mockCreate.mockRejectedValue({ code: "P2002" }) // but a concurrent create beat this one
    const result = await createUser(undefined, fd(validNewUser))
    expect(result).toEqual({ error: "Email already in use" })
  })

  it("stores an unusable random passwordHash (invite flow)", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 99, email: "jane@example.com", name: "Jane Smith", role: "VIEWER" })
    mockUpdate.mockResolvedValue({ id: 99 })
    await createUser(undefined, fd(validNewUser))
    // hash() must be called with a random hex string (not the user's chosen password)
    const hashCall = mockHash.mock.calls[0]
    expect(hashCall[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(hashCall[1]).toBe(12)
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ passwordHash: "hashed-pw", email: "jane@example.com" }),
    })
  })

  it("redirects to /users on success", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 99 })
    await createUser(undefined, fd(validNewUser))
    expect(mockRevalidate).toHaveBeenCalledWith("/users")
    expect(mockRedirect).toHaveBeenCalledWith("/users")
  })

  it("audit-logs USER_CREATED with targetUserId, not the email", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 99 })
    await createUser(undefined, fd(validNewUser))
    expect(mockLogAudit).toHaveBeenCalledWith(1, "USER_CREATED", "User", 99, { targetUserId: 99 })
  })
})

// --- updateUser ---
describe("updateUser", () => {
  // Target exists by default; the not-found test overrides this. updateUser
  // looks the target up by id (existence) before the email-collision findFirst.
  beforeEach(() => mockFindUnique.mockResolvedValue({ id: 1 }))

  it("returns error when target user not found", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null)
    const result = await updateUser(999, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(result).toEqual({ error: "User not found" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error for email collision", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindFirst.mockResolvedValue({ id: 99 })
    const result = await updateUser(1, undefined, fd({ name: "X", email: "taken@x.com", role: "VIEWER" }))
    expect(result).toEqual({ error: "Email already in use" })
  })

  it("does not rehash when no new password", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindFirst.mockResolvedValue(null)
    await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(mockHash).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.not.objectContaining({ passwordHash: expect.anything() }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/users")
  })

  it("rehashes when new password provided", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindFirst.mockResolvedValue(null)
    await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER", password: "Newpass9!" }))
    expect(mockHash).toHaveBeenCalledWith("Newpass9!", 12)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ passwordHash: "hashed-pw" }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/users")
  })

  it("invalidates target user's sessions when password changes", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindFirst.mockResolvedValue(null)
    await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER", password: "Newpass9!" }))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ sessionsValidFrom: expect.any(Date) }),
    })
  })

  it("clears all four lockout fields on admin-forced password change", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindFirst.mockResolvedValue(null)
    await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER", password: "Newpass9!" }))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        failedLoginAttempts: 0,
        lockedUntil: null,
        failedOtpAttempts: 0,
        otpLockedUntil: null,
      }),
    })
  })

  it("does not touch lockout fields when no password change", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindFirst.mockResolvedValue(null)
    await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.not.objectContaining({ lockedUntil: expect.anything() }),
    })
  })

  it("does not touch sessionsValidFrom when no password change", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindFirst.mockResolvedValue(null)
    await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.not.objectContaining({ sessionsValidFrom: expect.anything() }),
    })
  })

  it("audit-logs USER_UPDATED with role and passwordChanged", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    mockFindFirst.mockResolvedValue(null)
    await updateUser(5, undefined, fd({ name: "X", email: "x@x.com", role: "ADMIN", password: "Newpass9!" }))
    expect(mockLogAudit).toHaveBeenCalledWith(42, "USER_UPDATED", "User", 5, {
      targetUserId: 5,
      role: "ADMIN",
      passwordChanged: true,
    })
  })

  it("audit-logs USER_UPDATED with passwordChanged=false when no password", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    mockFindFirst.mockResolvedValue(null)
    await updateUser(5, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(mockLogAudit).toHaveBeenCalledWith(42, "USER_UPDATED", "User", 5, {
      targetUserId: 5,
      role: "VIEWER",
      passwordChanged: false,
    })
  })

  // --- last-admin demotion guard ---
  it("blocks demoting the last remaining ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 1, role: "ADMIN" })
    mockCount.mockResolvedValue(0) // no other admins
    const result = await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(result).toEqual({ error: "Cannot remove the last administrator" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("allows demoting an ADMIN when another ADMIN remains", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 2, role: "ADMIN" })
    mockCount.mockResolvedValue(1) // one other admin survives
    mockFindFirst.mockResolvedValue(null)
    await updateUser(2, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(mockUpdate).toHaveBeenCalled()
    expect(mockRedirect).toHaveBeenCalledWith("/users")
  })

  it("does not count admins when role stays ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 1, role: "ADMIN" })
    mockFindFirst.mockResolvedValue(null)
    await updateUser(1, undefined, fd({ name: "X", email: "x@x.com", role: "ADMIN" }))
    expect(mockCount).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalled()
  })

  // --- atomic last-admin guard: the recount + demote write must run
  // inside one Serializable transaction, not as two separate round trips, or
  // two concurrent demotes of different admins can both pass the "count > 1"
  // check before either write commits, leaving zero ADMINs.
  it("runs the recount and the demote write inside one Serializable transaction", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 2, role: "ADMIN" })
    mockCount.mockResolvedValue(1)
    mockFindFirst.mockResolvedValue(null)
    await updateUser(2, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
    // the recount must happen after $transaction is invoked (i.e. inside it),
    // not before — otherwise it's the same check-then-act race being fixed.
    const countOrder = mockCount.mock.invocationCallOrder[0]
    const txOrder = mockTransaction.mock.invocationCallOrder[0]
    expect(countOrder).toBeGreaterThan(txOrder)
  })

  it("surfaces a clean retry error when a concurrent demote wins the Serializable race", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 2, role: "ADMIN" })
    // Both concurrent transactions' pre-write counts looked safe; Postgres
    // aborts the loser with a Serializable write-conflict (P2034) instead of
    // letting both writes land and drop the ADMIN count to zero.
    mockTransaction.mockRejectedValue({ code: "P2034" })
    const result = await updateUser(2, undefined, fd({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(result?.error).toMatch(/try again/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  // --- P2002 unique-email race backstop ---
  it("returns a clean error when the write hits a concurrent email P2002", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 1, role: "VIEWER" })
    mockFindFirst.mockResolvedValue(null) // pre-check saw the email as free
    mockTransaction.mockRejectedValue({ code: "P2002" }) // but a concurrent write beat this one
    const result = await updateUser(1, undefined, fd({ name: "X", email: "taken@x.com", role: "VIEWER" }))
    expect(result).toEqual({ error: "Email already in use" })
  })
})

// --- deleteUser ---
describe("deleteUser", () => {
  beforeEach(() => mockFindUnique.mockResolvedValue({ id: 5 }))

  it("returns error when target user not found", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    mockFindUnique.mockResolvedValue(null)
    const result = await deleteUser(999)
    expect(result).toEqual({ error: "User not found" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await deleteUser(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deleteUser(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await deleteUser(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("prevents self-deletion", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await deleteUser(1)
    expect(result).toEqual({ error: "Cannot delete your own account" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("soft-deletes (archives) another user for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    await deleteUser(5)
    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ archivedAt: expect.any(Date), sessionsValidFrom: expect.any(Date) }),
      })
    )
    expect(mockRevalidate).toHaveBeenCalledWith("/users")
  })

  it("blocks deleting the last remaining ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    mockFindUnique.mockResolvedValue({ id: 5, role: "ADMIN" })
    mockCount.mockResolvedValue(0)
    const result = await deleteUser(5)
    expect(result).toEqual({ error: "Cannot delete the last administrator" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("allows deleting an ADMIN when another ADMIN remains", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    mockFindUnique.mockResolvedValue({ id: 5, role: "ADMIN" })
    mockCount.mockResolvedValue(2)
    await deleteUser(5)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ archivedAt: expect.any(Date) }) })
    )
  })

  // --- atomic last-admin guard, same fix as updateUser above ---
  it("runs the recount and the delete inside one Serializable transaction", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    mockFindUnique.mockResolvedValue({ id: 5, role: "ADMIN" })
    mockCount.mockResolvedValue(2)
    await deleteUser(5)
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
    const countOrder = mockCount.mock.invocationCallOrder[0]
    const txOrder = mockTransaction.mock.invocationCallOrder[0]
    expect(countOrder).toBeGreaterThan(txOrder)
  })

  it("surfaces a clean retry error when a concurrent delete wins the Serializable race", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    mockFindUnique.mockResolvedValue({ id: 5, role: "ADMIN" })
    mockTransaction.mockRejectedValue({ code: "P2034" })
    const result = await deleteUser(5)
    expect(result?.error).toMatch(/try again/i)
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

// --- unlockUser ---
describe("unlockUser", () => {
  beforeEach(() => mockFindUnique.mockResolvedValue({ id: 3 }))

  it("returns error when target user not found", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    mockFindUnique.mockResolvedValue(null)
    const result = await unlockUser(999)
    expect(result).toEqual({ error: "User not found" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await unlockUser(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await unlockUser(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await unlockUser(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("resets password and OTP lockout state for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    await unlockUser(3)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { failedLoginAttempts: 0, lockedUntil: null, failedOtpAttempts: 0, otpLockedUntil: null },
    })
    expect(mockRevalidate).toHaveBeenCalledWith("/users")
  })

  it("audit-logs USER_UNLOCKED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "42" } })
    await unlockUser(3)
    expect(mockLogAudit).toHaveBeenCalledWith(42, "USER_UNLOCKED", "User", 3)
  })
})

// --- OFFICE_ADMIN escalation guards ---
describe("user actions — OFFICE_ADMIN escalation guards", () => {
  const prismaMock = prisma.user as jest.Mocked<typeof prisma.user>

  beforeEach(() => resetMocks())

  function mockAuth(session: { user: { id: string; role: string } }) {
    mockSession.mockResolvedValue(session)
  }

  it("OFFICE_ADMIN cannot create an ADMIN", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const r = await createUser(undefined, fd({ name: "X", email: "x@y.com", password: "Abcdef1!", role: "ADMIN" }))
    expect(r).toEqual({ error: "Unauthorized" })
  })
  it("OFFICE_ADMIN can create a VIEWER", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    prismaMock.findUnique.mockResolvedValue(null)        // email free
    prismaMock.create.mockResolvedValue({ id: 9 } as never)
    mockRedirect.mockImplementationOnce(() => { throw new Error("REDIRECT") })
    await expect(createUser(undefined, fd({ name: "X", email: "x@y.com", password: "Abcdef1!", role: "VIEWER" })))
      .rejects.toThrow("REDIRECT")                      // redirect() throws on success
  })
  it("OFFICE_ADMIN cannot edit an ADMIN target", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    prismaMock.findUnique.mockResolvedValue({ id: 2, role: "ADMIN" } as never)
    const r = await updateUser(2, undefined, fd({ name: "X", email: "x@y.com", role: "VIEWER" }))
    expect(r).toEqual({ error: "Unauthorized" })
  })
  it("OFFICE_ADMIN cannot promote a VIEWER to ADMIN", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    prismaMock.findUnique.mockResolvedValue({ id: 2, role: "VIEWER" } as never)
    const r = await updateUser(2, undefined, fd({ name: "X", email: "x@y.com", role: "ADMIN" }))
    expect(r).toEqual({ error: "Unauthorized" })
  })
  it("OFFICE_ADMIN cannot delete an ADMIN", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    prismaMock.findUnique.mockResolvedValue({ id: 2, role: "ADMIN" } as never)
    const r = await deleteUser(2)
    expect(r).toEqual({ error: "Unauthorized" })
  })
  it("PASTOR still fully unauthorized for user mgmt", async () => {
    mockAuth({ user: { id: "1", role: "PASTOR" } })
    const r = await createUser(undefined, fd({ name: "X", email: "x@y.com", password: "Abcdef1!", role: "VIEWER" }))
    expect(r).toEqual({ error: "Unauthorized" })
  })

  // PASTOR is elevated (canAccessAccounting + canSeePastoralNotes, both denied
  // to OFFICE_ADMIN). Granting/editing it must be ADMIN-only too, not just ADMIN
  // — else an OFFICE_ADMIN self-grants PASTOR or takes over a
  // PASTOR account by resetting its password.
  it("OFFICE_ADMIN cannot create a PASTOR", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const r = await createUser(undefined, fd({ name: "X", email: "x@y.com", password: "Abcdef1!", role: "PASTOR" }))
    expect(r).toEqual({ error: "Unauthorized" })
  })
  it("OFFICE_ADMIN cannot promote a VIEWER to PASTOR", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    prismaMock.findUnique.mockResolvedValue({ id: 2, role: "VIEWER" } as never)
    const r = await updateUser(2, undefined, fd({ name: "X", email: "x@y.com", role: "PASTOR" }))
    expect(r).toEqual({ error: "Unauthorized" })
  })
  it("OFFICE_ADMIN cannot edit an existing PASTOR target", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    prismaMock.findUnique.mockResolvedValue({ id: 2, role: "PASTOR" } as never)
    const r = await updateUser(2, undefined, fd({ name: "X", email: "x@y.com", role: "PASTOR" }))
    expect(r).toEqual({ error: "Unauthorized" })
  })

  // deleteUser previously only guarded ADMIN targets, not PASTOR — an
  // OFFICE_ADMIN could archive a pastor's account, tombstone its email, and
  // kill its sessions. Must match updateUser's canAssignRole target gate above.
  it("OFFICE_ADMIN cannot delete a PASTOR", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    prismaMock.findUnique.mockResolvedValue({ id: 2, role: "PASTOR" } as never)
    const r = await deleteUser(2)
    expect(r).toEqual({ error: "Unauthorized" })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// --- input bounds ---
describe("createUser input bounds", () => {
  beforeEach(() => mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } }))

  it("rejects an over-long name before any DB call (DoS guard)", async () => {
    const result = await createUser(undefined, fd({ ...validNewUser, name: "x".repeat(201) }))
    expect(result?.error).toMatch(/too long/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects an over-long email", async () => {
    const result = await createUser(undefined, fd({ ...validNewUser, email: "a".repeat(250) + "@example.com" }))
    expect(result?.error).toMatch(/too long/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

// helpers reused by the invite-flow suites below
function mockAuth(session: { user: { id: string; role: string } }) {
  mockSession.mockResolvedValue(session)
}
const prismaMock = prisma.user as jest.Mocked<typeof prisma.user>

describe("createUser — invite flow", () => {
  beforeEach(() => {
    resetMocks()
    ;(sendWelcomeEmail as jest.Mock).mockResolvedValue(undefined)
  })

  it("creates a user without a password input and issues an invite", async () => {
    mockAuth({ user: { id: "1", role: "ADMIN" } })
    prismaMock.findUnique.mockResolvedValue(null)          // email free
    prismaMock.create.mockResolvedValue({ id: 9, email: "x@y.com", name: "X", role: "VIEWER" } as never)
    prismaMock.update.mockResolvedValue({ id: 9 } as never)
    await createUser(undefined, fd({ name: "X", email: "x@y.com", role: "VIEWER" }))
    // token written with a future expiry
    const upd = prismaMock.update.mock.calls[0][0]
    expect(upd.data.passwordResetToken).toMatch(/^[0-9a-f]{64}$/)
    expect((upd.data.passwordResetExpires as Date).getTime()).toBeGreaterThan(Date.now())
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
  })

  it("still blocks OFFICE_ADMIN from creating an ADMIN", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const r = await createUser(undefined, fd({ name: "X", email: "x@y.com", role: "ADMIN" }))
    expect(r).toEqual({ error: "Unauthorized" })
  })

  it("creates the user even if the email send throws", async () => {
    mockAuth({ user: { id: "1", role: "ADMIN" } })
    prismaMock.findUnique.mockResolvedValue(null)
    prismaMock.create.mockResolvedValue({ id: 9, email: "x@y.com", name: "X", role: "VIEWER" } as never)
    prismaMock.update.mockResolvedValue({ id: 9 } as never)
    ;(sendWelcomeEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    // createUser completes (redirects) even if email throws — failure is swallowed
    await createUser(undefined, fd({ name: "X", email: "x@y.com", role: "VIEWER" }))
    expect(prismaMock.create).toHaveBeenCalled()
  })

  it("still creates the user when storing the invite token fails", async () => {
    mockAuth({ user: { id: "1", role: "ADMIN" } })
    prismaMock.findUnique.mockResolvedValue(null)
    prismaMock.create.mockResolvedValue({ id: 9, email: "x@y.com", name: "X", role: "VIEWER" } as never)
    prismaMock.update.mockRejectedValue(new Error("pg down"))
    mockRedirect.mockImplementationOnce(() => { throw new Error("REDIRECT") })
    // createUser completes (redirects) even if token store throws — failure is swallowed
    await expect(createUser(undefined, fd({ name: "X", email: "x@y.com", role: "VIEWER" })))
      .rejects.toThrow("REDIRECT")
    expect(prismaMock.create).toHaveBeenCalled()
  })

  // the failure-cleanup update must be scoped to the hash THIS call
  // wrote, not an unconditional clear on `id` alone — otherwise this call's
  // failure handler could erase a newer token written by an overlapping
  // create/resend for the same user.
  it("scopes the failure-cleanup clear to the token hash this invocation wrote", async () => {
    mockAuth({ user: { id: "1", role: "ADMIN" } })
    prismaMock.findUnique.mockResolvedValue(null)
    prismaMock.create.mockResolvedValue({ id: 9, email: "x@y.com", name: "X", role: "VIEWER" } as never)
    prismaMock.update.mockResolvedValue({ id: 9 } as never)
    ;(sendWelcomeEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    await createUser(undefined, fd({ name: "X", email: "x@y.com", role: "VIEWER" }))
    const storeCall = prismaMock.update.mock.calls[0][0]
    const cleanupCall = prismaMock.update.mock.calls[1][0]
    const writtenHash = storeCall.data.passwordResetToken
    expect(cleanupCall.where).toEqual({ id: 9, passwordResetToken: writtenHash })
    expect(cleanupCall.data).toEqual({ passwordResetToken: null, passwordResetExpires: null })
  })
})

describe("resendWelcome", () => {
  beforeEach(() => {
    resetMocks()
    ;(sendWelcomeEmail as jest.Mock).mockResolvedValue(undefined)
  })

  it("re-issues a token and re-sends for a non-ADMIN target", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    prismaMock.findUnique.mockResolvedValue({ id: 2, email: "v@y.com", name: "V", role: "VIEWER" } as never)
    prismaMock.update.mockResolvedValue({ id: 2 } as never)
    const r = await resendWelcome(2)
    expect(r).toEqual({ success: true })
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
  })

  it("blocks a non-ADMIN actor from resending to an ADMIN", async () => {
    mockAuth({ user: { id: "1", role: "OFFICE_ADMIN" } })
    prismaMock.findUnique.mockResolvedValue({ id: 2, email: "a@y.com", name: "A", role: "ADMIN" } as never)
    const r = await resendWelcome(2)
    expect(r).toEqual({ error: "Unauthorized" })
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it("returns User not found for a missing id", async () => {
    mockAuth({ user: { id: "1", role: "ADMIN" } })
    prismaMock.findUnique.mockResolvedValue(null)
    expect(await resendWelcome(999)).toEqual({ error: "User not found" })
  })

  it("returns an error (not success) when the email send fails", async () => {
    mockAuth({ user: { id: "1", role: "ADMIN" } })
    prismaMock.findUnique.mockResolvedValue({ id: 2, email: "v@y.com", name: "V", role: "VIEWER" } as never)
    prismaMock.update.mockResolvedValue({ id: 2 } as never)
    ;(sendWelcomeEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
    const r = await resendWelcome(2)
    expect("error" in r!).toBe(true)
  })

  // outside development a missing AUTH_URL must fail the invite, not
  // silently mail a link that resolves to the recipient's own machine.
  it("fails safely instead of emailing a localhost link when AUTH_URL is unset in production", async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevAuthUrl = process.env.AUTH_URL
    ;(process.env as { NODE_ENV: string }).NODE_ENV = "production"
    delete process.env.AUTH_URL
    try {
      mockAuth({ user: { id: "1", role: "ADMIN" } })
      prismaMock.findUnique.mockResolvedValue({ id: 2, email: "v@y.com", name: "V", role: "VIEWER" } as never)
      const r = await resendWelcome(2)
      expect(r).toEqual({ error: "Could not send the welcome email. Check email configuration." })
      expect(sendWelcomeEmail).not.toHaveBeenCalled()
      expect(prismaMock.update).not.toHaveBeenCalled()
    } finally {
      ;(process.env as { NODE_ENV: string }).NODE_ENV = prevNodeEnv as string
      if (prevAuthUrl !== undefined) process.env.AUTH_URL = prevAuthUrl
    }
  })

  it("still builds a localhost link in development when AUTH_URL is unset", async () => {
    const prevAuthUrl = process.env.AUTH_URL
    delete process.env.AUTH_URL
    try {
      mockAuth({ user: { id: "1", role: "ADMIN" } })
      prismaMock.findUnique.mockResolvedValue({ id: 2, email: "v@y.com", name: "V", role: "VIEWER" } as never)
      prismaMock.update.mockResolvedValue({ id: 2 } as never)
      const r = await resendWelcome(2)
      expect(r).toEqual({ success: true })
      const call = (sendWelcomeEmail as jest.Mock).mock.calls[0]
      expect(call[1].setPasswordUrl).toContain("http://localhost:3000")
    } finally {
      if (prevAuthUrl !== undefined) process.env.AUTH_URL = prevAuthUrl
    }
  })
})

// the target-role check and the write must be atomic — a concurrent
// promotion to ADMIN/PASTOR between the pre-read and the write must not let a
// non-ADMIN actor's in-flight request act on the now-elevated account.
describe("unlock / resend target-role check is atomic with the write", () => {
  const p2025 = Object.assign(new Error("Record not found"), { code: "P2025" })

  it("unlockUser by OFFICE_ADMIN conditions the write on a non-elevated role", async () => {
    mockSession.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 3, role: "VIEWER", archivedAt: null })
    mockUpdate.mockResolvedValue({})
    await unlockUser(3)
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: 3, role: { notIn: ["ADMIN", "PASTOR"] } })
  })

  it("unlockUser returns Unauthorized when the target was promoted mid-flight", async () => {
    mockSession.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 3, role: "VIEWER", archivedAt: null })
    mockUpdate.mockRejectedValue(p2025)
    expect(await unlockUser(3)).toEqual({ error: "Unauthorized" })
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("resendWelcome by OFFICE_ADMIN conditions the token write on a non-elevated role and sends nothing if promoted", async () => {
    mockSession.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 2, email: "v@y.com", name: "V", role: "VIEWER", archivedAt: null })
    mockUpdate.mockRejectedValue(p2025)
    const r = await resendWelcome(2)
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: 2, role: { notIn: ["ADMIN", "PASTOR"] } })
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect("error" in r).toBe(true)
  })
})
