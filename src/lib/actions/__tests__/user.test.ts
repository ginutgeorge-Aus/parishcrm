/** @jest-environment node */
import { createUser, updateUser, deleteUser, unlockUser, resendWelcome, resetUserTotp, revokeUserPasskeys } from "@/lib/actions/user"
import { canAssignRole } from "@/lib/roleGuard"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { sendWelcomeEmail } from "@/lib/email"
import { logAudit, logAuditTx } from "@/lib/audit"
import { revalidatePath } from "next/cache"

// Locks in the user-admin guards that lock an org out of the app if they
// regress: the last-admin Serializable recount, the OFFICE_ADMIN →
// ADMIN escalation blocks, the self-action guards, and the concurrent-write
// (P2002/P2034) error translations.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  logAuditTx: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Headers()) }))
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
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    trustedDevice: { deleteMany: jest.fn() },
    passkey: { deleteMany: jest.fn() },
    backupCode: { deleteMany: jest.fn() },
    auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
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
  // Interactive transactions run against the same mocked client by default.
  ;(prisma.$transaction as jest.Mock).mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma))
  ;(logAuditTx as jest.Mock).mockResolvedValue(undefined)
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null)
  ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([]) // no email collision unless a test says so
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
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN", email: "old@x.com" })
    const r = await updateUser(3, undefined, form(VALID_USER))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("blocks OFFICE_ADMIN from promoting a user to ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "old@x.com" })
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
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN", email: "old@x.com" })
    expect(await deleteUser(3)).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("blocks OFFICE_ADMIN from deleting a PASTOR target", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "PASTOR", email: "old@x.com" })
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
    ["OFFICE_ADMIN", "EVENT_ORGANISER"],
  ])("allows %s to unlock and re-invite a %s target", async (actorRole, targetRole) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "2", role: actorRole } })
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 3, role: targetRole, email: "user@example.com", name: "User", archivedAt: null,
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({ id: 3 })
    // Non-ADMIN writes carry the atomic target-role predicate.
    const where = actorRole === "ADMIN" ? { id: 3 } : { id: 3, role: { notIn: ["ADMIN", "PASTOR", "OFFICE_ADMIN"] } }

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
          findUnique: jest.fn().mockResolvedValue({ role: "ADMIN", email: "x@x.com", archivedAt: null }),
          count: jest.fn().mockResolvedValue(count),
          update: jest.fn().mockResolvedValue({}),
          delete: jest.fn().mockResolvedValue({}),
        },
      })
  }

  it("blocks demoting the last ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN", email: "old@x.com" })
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([])
    ;(prisma.$transaction as jest.Mock).mockImplementation(txWithOtherAdmins(0))
    const r = await updateUser(3, undefined, form({ name: "X", email: "x@x.com", role: "VIEWER" }))
    expect(r).toEqual({ error: "Cannot remove the last administrator" })
  })

  it("blocks deleting the last ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN", email: "old@x.com" })
    ;(prisma.$transaction as jest.Mock).mockImplementation(txWithOtherAdmins(0))
    const r = await deleteUser(3)
    expect(r).toEqual({ error: "Cannot delete the last administrator" })
  })

  it("allows demoting an ADMIN when another ADMIN remains", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN", email: "old@x.com" })
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([])
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
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "old@x.com", archivedAt: null })
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([])
    const txCount = jest.fn().mockResolvedValue(0) // tx-local: no other admins survive
    const txUpdate = jest.fn().mockResolvedValue({})
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({
        user: {
          findUnique: jest.fn().mockResolvedValue({ role: "ADMIN", email: "x@x.com", archivedAt: null }),
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
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "ADMIN", email: "old@x.com" })
    ;(prisma.$transaction as jest.Mock).mockRejectedValue(p2034)
    const r = await deleteUser(3)
    expect(r).toEqual({ error: "Cannot delete the last administrator — please try again." })
  })

  it("maps a P2002 on create to a friendly duplicate-email error", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([]) // no pre-existing email
    ;(prisma.user.create as jest.Mock).mockRejectedValue(p2002)
    const r = await createUser(undefined, form(VALID_USER))
    expect(r).toEqual({ error: "Email already in use" })
  })

  it("rejects a duplicate email caught by the pre-check on create", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: 7 }])
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

// AUD-1-02: an OFFICE_ADMIN may not manage a peer OFFICE_ADMIN (takeover via
// email/password/2FA reset); user changes are audited old->new inside the same
// transaction and fail closed; email/role changes void old credentials.
describe("AUD-1-02 peer takeover, in-transaction audit, credential invalidation", () => {
  const OFFICE = { user: { id: "2", role: "OFFICE_ADMIN" } }
  const PEER = { id: 3, role: "OFFICE_ADMIN", email: "peer@example.com", name: "Peer", archivedAt: null }

  /**
   * Tx client whose in-transaction reload returns `current`.
   * @param current the row the transaction re-reads
   * @returns the tx mock and its update spy
   */
  function txReturning(current: Record<string, unknown>) {
    const update = jest.fn().mockResolvedValue({})
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(current),
        count: jest.fn().mockResolvedValue(1),
        update,
        create: jest.fn().mockResolvedValue({ id: 3 }),
      },
      trustedDevice: { deleteMany: jest.fn() },
      passkey: { deleteMany: jest.fn() },
    }
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb: (t: unknown) => unknown) => cb(tx))
    return { tx, update }
  }

  it.each([
    ["ADMIN", "OFFICE_ADMIN", true],
    ["ADMIN", "ADMIN", true],
    ["OFFICE_ADMIN", "OFFICE_ADMIN", false],
    ["OFFICE_ADMIN", "ADMIN", false],
    ["OFFICE_ADMIN", "PASTOR", false],
    ["OFFICE_ADMIN", "VIEWER", true],
    ["OFFICE_ADMIN", "EVENT_ORGANISER", true],
  ] as const)("canAssignRole(%s, %s) is %s", (actor, target, expected) => {
    expect(canAssignRole(actor as UserRole, target as UserRole)).toBe(expected)
  })

  it("refuses OFFICE_ADMIN updating a peer OFFICE_ADMIN before any transaction", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(PEER)
    const r = await updateUser(3, undefined, form({ name: "X", email: "attacker@example.com", role: "VIEWER", password: "Newpass9!x" }))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ["deleteUser", () => deleteUser(3)],
    ["unlockUser", () => unlockUser(3)],
    ["resetUserTotp", () => resetUserTotp(3)],
    ["revokeUserPasskeys", () => revokeUserPasskeys(3)],
    ["resendWelcome", () => resendWelcome(3)],
  ] as const)("refuses OFFICE_ADMIN %s on a peer OFFICE_ADMIN with no write", async (_name, action) => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(PEER)
    expect(await action()).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it("refuses OFFICE_ADMIN creating or granting OFFICE_ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    expect(await createUser(undefined, form({ ...VALID_USER, role: "OFFICE_ADMIN" }))).toEqual({ error: "Unauthorized" })
    expect(prisma.user.create).not.toHaveBeenCalled()
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "v@example.com", archivedAt: null })
    expect(await updateUser(3, undefined, form({ name: "V", email: "v@example.com", role: "OFFICE_ADMIN" }))).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("lets ADMIN create an OFFICE_ADMIN, audited in the transaction", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.create as jest.Mock).mockResolvedValue({ id: 11, role: "OFFICE_ADMIN", email: "o@example.com", name: "O" })
    await expect(createUser(undefined, form({ ...VALID_USER, role: "OFFICE_ADMIN" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 9, "USER_CREATED", "User", 11, { targetUserId: 11, toRole: "OFFICE_ADMIN" }, undefined)
  })

  it("lets ADMIN edit an OFFICE_ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(PEER)
    const { update } = txReturning(PEER)
    await expect(updateUser(3, undefined, form({ name: "Peer", email: "peer@example.com", role: "OFFICE_ADMIN" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(update).toHaveBeenCalled()
  })

  it("re-checks the target role inside the transaction (outer VIEWER, promoted to PASTOR)", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "v@example.com", archivedAt: null })
    const { update } = txReturning({ role: "PASTOR", email: "v@example.com", archivedAt: null })
    expect(await updateUser(3, undefined, form({ name: "V", email: "v@example.com", role: "VIEWER" }))).toEqual({ error: "Unauthorized" })
    expect(update).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
  })

  it("re-checks the target role inside the deleteUser transaction", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "v@example.com", archivedAt: null })
    const { update } = txReturning({ role: "OFFICE_ADMIN", email: "v@example.com", archivedAt: null })
    expect(await deleteUser(3)).toEqual({ error: "Unauthorized" })
    expect(update).not.toHaveBeenCalled()
  })

  it("audits old and new role and email change (no addresses) in the update transaction", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "old@example.com", archivedAt: null })
    const { tx } = txReturning({ role: "VIEWER", email: "old@example.com", archivedAt: null })
    await expect(updateUser(3, undefined, form({ name: "V", email: "new@example.com", role: "OFFICE_ADMIN" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(logAuditTx).toHaveBeenCalledWith(tx, 9, "USER_UPDATED", "User", 3, {
      targetUserId: 3, fromRole: "VIEWER", toRole: "OFFICE_ADMIN", emailChanged: true, passwordChanged: false,
    }, undefined)
    expect(logAudit).not.toHaveBeenCalled()
  })

  it.each([
    ["updateUser", () => updateUser(3, undefined, form({ name: "V", email: "v@example.com", role: "VIEWER" }))],
    ["deleteUser", () => deleteUser(3)],
    ["createUser", () => createUser(undefined, form(VALID_USER))],
    ["unlockUser", () => unlockUser(3)],
  ] as const)("%s fails closed when the audit write fails", async (_name, action) => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "v@example.com", archivedAt: null })
    txReturning({ role: "VIEWER", email: "v@example.com", archivedAt: null })
    // The real $transaction rejects when its callback throws, rolling the write back.
    ;(logAuditTx as jest.Mock).mockRejectedValue(new Error("audit table down"))
    const r = await action()
    expect(r).toEqual({ error: expect.stringMatching(/audit log/) })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it("an email change voids reset links and OTP codes and ends sessions", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "old@example.com", archivedAt: null })
    const { update } = txReturning({ role: "VIEWER", email: "old@example.com", archivedAt: null })
    await expect(updateUser(3, undefined, form({ name: "V", email: "new@example.com", role: "VIEWER" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(update.mock.calls[0][0].data).toEqual(expect.objectContaining({
      passwordResetToken: null, passwordResetExpires: null, otpCode: null, otpExpiresAt: null, sessionsValidFrom: expect.any(Date),
    }))
  })

  it("a role change ends sessions; a name-only change does not", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "v@example.com", archivedAt: null })
    let { update } = txReturning({ role: "VIEWER", email: "v@example.com", archivedAt: null })
    await expect(updateUser(3, undefined, form({ name: "V", email: "v@example.com", role: "AUDITOR" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(update.mock.calls[0][0].data.sessionsValidFrom).toBeInstanceOf(Date)
    expect(update.mock.calls[0][0].data).not.toHaveProperty("passwordResetToken")
    ;({ update } = txReturning({ role: "VIEWER", email: "v@example.com", archivedAt: null }))
    await expect(updateUser(3, undefined, form({ name: "Renamed", email: "v@example.com", role: "VIEWER" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(update.mock.calls[0][0].data).not.toHaveProperty("sessionsValidFrom")
  })

  it.each([
    ["email", { name: "Me", email: "other@example.com", role: "ADMIN" }],
    ["role", { name: "Me", email: "me@example.com", role: "VIEWER" }],
    ["password", { name: "Me", email: "me@example.com", role: "ADMIN", password: "Newpass9!x" }],
  ])("self-edit refuses a changed %s", async (_field, fields) => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 9, role: "ADMIN", email: "me@example.com", archivedAt: null })
    const r = await updateUser(9, undefined, form(fields))
    expect(r).toEqual({ error: expect.stringContaining("only change your own name") })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("self-edit of the name only writes the name", async () => {
    ;(auth as jest.Mock).mockResolvedValue(OFFICE)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 2, role: "OFFICE_ADMIN", email: "me@example.com", archivedAt: null })
    const { update } = txReturning({ role: "OFFICE_ADMIN", email: "me@example.com", archivedAt: null })
    await expect(updateUser(2, undefined, form({ name: "New Name", email: "me@example.com", role: "OFFICE_ADMIN" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(update).toHaveBeenCalledWith({ where: { id: 2 }, data: { name: "New Name" } })
  })

  it("resendWelcome refuses a user who has already signed in", async () => {
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 3, role: "VIEWER", email: "v@example.com", name: "V", archivedAt: null })
    ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({ id: 1 })
    const r = await resendWelcome(3)
    expect(r).toEqual({ error: expect.stringContaining("already signed in") })
    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({ where: { userId: 3, action: "USER_LOGIN" }, select: { id: true } })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
  })
})
