/** @jest-environment node */
import { createUser, updateUser, deleteUser, unlockUser, resendWelcome } from "@/lib/actions/user"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { sendWelcomeEmail } from "@/lib/email"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"

// Locks in the user-admin guards that lock an org out of the app if they
// regress: the last-admin Serializable recount, the OFFICE_ADMIN →
// ADMIN escalation blocks, the self-action guards, and the concurrent-write
// (P2002/P2034) error translations.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/email", () => ({ sendWelcomeEmail: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    trustedDevice: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
  // user.ts now re-imports `Prisma` from this module instead of the generated
  // client directly — the isolation-level enum value must still resolve.
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const ADMIN = { user: { id: "9", role: "ADMIN" } }
const VALID_USER = { name: "New User", email: "new@example.com", role: "VIEWER" }

// P2002 (unique) / P2034 (serialization) shaped like Prisma's known errors —
// isP2002/isP2034 only inspect `.code`.
const p2002 = Object.assign(new Error("unique"), { code: "P2002" })
const p2034 = Object.assign(new Error("serialize"), { code: "P2034" })

beforeEach(() => {
  jest.clearAllMocks()
})

describe("role gate — canManageUsers (ADMIN | OFFICE_ADMIN)", () => {
  it.each([["VIEWER"], ["AUDITOR"], ["PASTOR"]])("rejects %s from createUser", async (role) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
    expect(await createUser(undefined, form(VALID_USER))).toEqual({ error: "Unauthorized" })
  })

  it("rejects a non-manager from deleteUser / unlockUser / resendWelcome", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "PASTOR" } })
    expect(await deleteUser(3)).toEqual({ error: "Unauthorized" })
    expect(await unlockUser(3)).toEqual({ error: "Unauthorized" })
    expect(await resendWelcome(3)).toEqual({ error: "Unauthorized" })
  })
})

describe("OFFICE_ADMIN cannot touch or create ADMIN accounts (self-escalation block)", () => {
  const OFFICE = { user: { id: "2", role: "OFFICE_ADMIN" } }

  it("blocks OFFICE_ADMIN from creating an ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    const r = await createUser(undefined, form({ ...VALID_USER, role: "ADMIN" }))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it("blocks OFFICE_ADMIN from editing an existing ADMIN target", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN" })
    const r = await updateUser(3, undefined, form(VALID_USER))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("blocks OFFICE_ADMIN from promoting a user to ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER" })
    const r = await updateUser(3, undefined, form({ ...VALID_USER, role: "ADMIN" }))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("blocks OFFICE_ADMIN from unlocking / re-inviting an ADMIN target", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN", email: "a@x.com", name: "A" })
    expect(await unlockUser(3)).toEqual({ error: "Unauthorized" })
    expect(await resendWelcome(3)).toEqual({ error: "Unauthorized" })
  })

  // deleteUser previously only guarded ADMIN targets, not PASTOR — an
  // OFFICE_ADMIN could archive a pastor's account, tombstone its email, and
  // kill its sessions. Must match updateUser's canAssignRole target gate.
  it("blocks OFFICE_ADMIN from deleting an ADMIN target", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN" })
    expect(await deleteUser(3)).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("blocks OFFICE_ADMIN from deleting a PASTOR target", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "PASTOR" })
    expect(await deleteUser(3)).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("unlock and welcome target-role guards", () => {
  it.each([
    ["unlock", unlockUser],
    ["re-invite", resendWelcome],
  ] as const)("blocks OFFICE_ADMIN from %s on a PASTOR without side effects", async (_name, action) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "2", role: "OFFICE_ADMIN" } })
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 3, role: "PASTOR", email: "pastor@example.com", name: "Pastor", archivedAt: null,
    })

    expect(await action(3)).toEqual({ error: "Unauthorized" })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    ["ADMIN", "ADMIN"],
    ["ADMIN", "PASTOR"],
    ["OFFICE_ADMIN", "VIEWER"],
    ["OFFICE_ADMIN", "AUDITOR"],
    ["OFFICE_ADMIN", "OFFICE_ADMIN"],
    ["OFFICE_ADMIN", "EVENT_ORGANISER"],
  ])("allows %s to unlock and re-invite a %s target", async (actorRole, targetRole) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "2", role: actorRole } })
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 3, role: targetRole, email: "user@example.com", name: "User", archivedAt: null,
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({ id: 3 })
    // Non-ADMIN writes carry the atomic target-role predicate.
    const where = actorRole === "ADMIN" ? { id: 3 } : { id: 3, role: { notIn: ["ADMIN", "PASTOR"] } }

    expect(await unlockUser(3)).toBeUndefined()
    expect(prisma.user.update).toHaveBeenCalledWith({
      where,
      data: { failedLoginAttempts: 0, lockedUntil: null, failedOtpAttempts: 0, otpLockedUntil: null },
    })
    expect(await resendWelcome(3)).toEqual({ success: true })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where,
      data: { passwordResetToken: expect.any(String), passwordResetExpires: expect.any(Date) },
    })
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1)
    expect(sendWelcomeEmail).toHaveBeenCalledWith("user@example.com", expect.objectContaining({ name: "User" }))
  })
})

describe("self-action guards", () => {
  it("blocks deleting your own account", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    expect(await deleteUser(9)).toEqual({ error: "Cannot delete your own account" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("blocks unlocking your own account", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    expect(await unlockUser(9)).toEqual({ error: "Cannot unlock your own account" })
  })
})

describe("last-admin guard", () => {
  // The recount + write run inside one Serializable transaction. Drive the
  // mocked $transaction with a tx client whose user.count reports 0 other admins.
  // findUnique reloads the target inside the tx — all three call sites
  // below target an ADMIN (matching the outer prisma.user.findUnique mock), so
  // a fixed ADMIN/not-archived reload keeps their existing behavior unchanged.
  function txWithOtherAdmins(count: number) {
    return (cb: (tx: unknown) => unknown) =>
      cb({
        user: {
          findUnique: jest.fn().mockResolvedValue({ role: "ADMIN", archivedAt: null }),
          count: jest.fn().mockResolvedValue(count),
          update: jest.fn().mockResolvedValue({}),
          delete: jest.fn().mockResolvedValue({}),
        },
      })
  }

  it("blocks demoting the last ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN" })
    ;(prisma.user.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.$transaction as jest.Mock).mockImplementation(txWithOtherAdmins(0))
    const r = await updateUser(3, undefined, form({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(r).toEqual({ error: "Cannot remove the last administrator" })
  })

  it("blocks deleting the last ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(txWithOtherAdmins(0))
    const r = await deleteUser(3)
    expect(r).toEqual({ error: "Cannot delete the last administrator" })
  })

  it("allows demoting an ADMIN when another ADMIN remains", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN" })
    ;(prisma.user.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.$transaction as jest.Mock).mockImplementation(txWithOtherAdmins(1))
    await expect(updateUser(3, undefined, form({ name: "X", email: "x@x.com", role: "VIEWER" }))).rejects.toThrow(
      "NEXT_REDIRECT"
    )
  })

  // Closes the stale-role race: the pre-transaction findUnique above
  // is only used for the authorization checks now — the recount decision must
  // reload the target INSIDE the transaction. Here the outer (stale) read says
  // the target is a VIEWER, so an unfixed implementation would skip the
  // recount entirely; the tx-local reload reveals a concurrent promotion to
  // ADMIN (the target is now the sole admin), so the guard must still fire.
  it("reloads the target role inside the transaction, so a concurrent promotion still triggers the last-admin guard", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", archivedAt: null })
    ;(prisma.user.findFirst as jest.Mock).mockResolvedValue(null)
    const txCount = jest.fn().mockResolvedValue(0) // tx-local: no other admins survive
    const txUpdate = jest.fn().mockResolvedValue({})
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({
        user: {
          findUnique: jest.fn().mockResolvedValue({ role: "ADMIN", archivedAt: null }),
          count: txCount,
          update: txUpdate,
        },
      })
    )
    const r = await updateUser(3, undefined, form({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(txCount).toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
    expect(r).toEqual({ error: "Cannot remove the last administrator" })
  })
})

describe("deleteUser soft-delete", () => {
  it("archives + tombstones the email instead of hard-deleting", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "v@x.com", archivedAt: null })
    const update = jest.fn().mockResolvedValue({})
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({
        user: {
          findUnique: jest.fn().mockResolvedValue({ role: "VIEWER", email: "v@x.com", archivedAt: null }),
          count: jest.fn().mockResolvedValue(1),
          update,
        },
      })
    )
    const r = await deleteUser(3)
    expect(r).toBeUndefined()
    const data = update.mock.calls[0][0].data
    expect(data.archivedAt).toBeInstanceOf(Date)
    expect(data.sessionsValidFrom).toBeInstanceOf(Date)
    expect(data.email).toBe("archived+3+v@x.com")
  })

  it("treats an already-archived user as not found", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "v@x.com", archivedAt: new Date() })
    expect(await deleteUser(3)).toEqual({ error: "User not found" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("concurrent-write error translation", () => {
  it("maps a P2034 serialization abort to a retry prompt on delete", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN" })
    ;(prisma.$transaction as jest.Mock).mockRejectedValue(p2034)
    const r = await deleteUser(3)
    expect(r).toEqual({ error: "Cannot delete the last administrator — please try again." })
  })

  it("maps a P2002 on create to a friendly duplicate-email error", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null) // no pre-existing email
    ;(prisma.user.create as jest.Mock).mockRejectedValue(p2002)
    const r = await createUser(undefined, form(VALID_USER))
    expect(r).toEqual({ error: "Email already in use" })
  })

  it("rejects a duplicate email caught by the pre-check on create", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 7 })
    const r = await createUser(undefined, form(VALID_USER))
    expect(r).toEqual({ error: "Email already in use" })
    expect(prisma.user.create).not.toHaveBeenCalled()
  })
})

describe("invalid target id guard (isValidPgId)", () => {
  it.each([0, -1, 2147483648])(
    "rejects updateUser/unlockUser/deleteUser/resendWelcome for out-of-range id %s before any DB lookup",
    async (id) => {
      ;(auth as jest.Mock).mockResolvedValue(ADMIN)
      expect(await updateUser(id, undefined, form(VALID_USER))).toEqual({ error: "User not found" })
      expect(await unlockUser(id)).toEqual({ error: "User not found" })
      expect(await deleteUser(id)).toEqual({ error: "User not found" })
      expect(await resendWelcome(id)).toEqual({ error: "User not found" })
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    }
  )
})

describe("validation", () => {
  it("rejects an invalid email before any DB call", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    const r = await createUser(undefined, form({ ...VALID_USER, email: "not-an-email" }))
    expect(r).toMatchObject({ error: expect.stringContaining("Invalid email") })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
