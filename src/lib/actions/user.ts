"use server"

import { auth } from "@/auth"
import { logger } from "@/lib/logger"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { hash } from "bcryptjs"
import { randomBytes, createHash } from "crypto"
import { prisma, Prisma } from "@/lib/prisma"
import { canManageUsers, canAssignRole, isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { sendWelcomeEmail } from "@/lib/email"
import { isP2002, isP2034, isValidPgId } from "@/lib/validation"
import type { ActionResult } from "./types"
import { UserRole } from "@/lib/generated/prisma/enums"

const ROLE_VALUES = Object.values(UserRole) as [UserRole, ...UserRole[]]

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  PASTOR: "Pastor",
  VIEWER: "Viewer",
  AUDITOR: "Auditor",
  OFFICE_ADMIN: "Office Admin",
  EVENT_ORGANISER: "Event Organiser",
}

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/
const PASSWORD_MSG =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character"

// Thrown inside the last-admin-guard transactions below (updateUser/deleteUser)
// to surface a clean ActionResult error instead of an unhandled throw.
class LastAdminError extends Error {}

// Thrown when the target reloaded INSIDE the updateUser/deleteUser
// serializable transaction turns out to be gone or archived — it
// vanished/got archived between the outer pre-transaction check and the
// transaction actually starting. Surfaces the same clean "User not found"
// ActionResult instead of writing over (or double-archiving) a gone user.
class TargetGoneError extends Error {}

// Block removing/demoting the last remaining ADMIN — including self. ADMIN is
// the only role that can manage users/accounting settings, so zero admins
// locks the org out of the app entirely (recovery needs DB shell access).
// MUST run on the `tx` client passed into the caller's Serializable
// transaction, and the write it guards must happen in that same transaction
//: recounting on a separate connection before the write is a
// check-then-act race — two concurrent demote/delete calls targeting
// different admins could each observe count > 1 before either write commits,
// leaving zero ADMINs. Under Serializable isolation Postgres instead aborts
// the losing transaction with a P2034 serialization failure, which the
// caller translates into a retry-prompt error.
async function assertNotLastAdmin(tx: Prisma.TransactionClient, excludeUserId: number, message: string): Promise<void> {
  // archivedAt: null — a soft-deleted admin is not a usable admin, so it
  // must not count toward "another admin exists".
  const otherAdmins = await tx.user.count({ where: { role: UserRole.ADMIN, archivedAt: null, NOT: { id: excludeUserId } } })
  if (otherAdmins === 0) throw new LastAdminError(message)
}

const CreateUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
  email: z.string().email("Invalid email").max(254, "Email is too long"),
  role: z.enum(ROLE_VALUES),
})

const UpdateUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
  email: z.string().email("Invalid email").max(254, "Email is too long"),
  password: z
    .string()
    .max(128, "Password is too long")
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => !v || PASSWORD_REGEX.test(v), PASSWORD_MSG),
  role: z.enum(ROLE_VALUES),
})

// Issues a 7-day set-password invite token on the user and emails the welcome
// message. Returns true if the email was sent. Never throws — callers keep the
// user regardless of email outcome.
const WELCOME_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Write-time mirror of canAssignRole's target check: ride this on the
// mutation's where-unique so a concurrent promotion to ADMIN/PASTOR between the
// authorization pre-read and the write makes the write miss (P2025) instead of
// acting on the now-elevated account. ADMIN actors are unrestricted.
function assignableTargetWhere(actorRole: UserRole | undefined) {
  return isAdmin(actorRole) ? {} : { role: { notIn: [UserRole.ADMIN, UserRole.PASTOR] } }
}

async function issueWelcomeInvite(
  user: {
    id: number
    email: string
    name: string
    role: UserRole
  },
  targetGuard: ReturnType<typeof assignableTargetWhere> = {},
): Promise<boolean> {
  const token = randomBytes(32).toString("hex")
  const tokenHash = createHash("sha256").update(token).digest("hex")
  const expires = new Date(Date.now() + WELCOME_INVITE_TTL_MS)

  // Outside development a missing/invalid AUTH_URL must fail the invite, not
  // silently mail a link that resolves on the recipient's own machine.
  // Dev keeps the localhost fallback so local `npm run dev` welcome emails
  // still build a usable link with no .env.local setup.
  const isDev = process.env.NODE_ENV !== "production"
  const base = process.env.AUTH_URL ?? (isDev ? "http://localhost:3000" : undefined)
  if (!base) {
    logger.error("issueWelcomeInvite: AUTH_URL is not set (required outside development), cannot build invite link")
    return false
  }
  let setPasswordUrl: string
  let helpUrl: string
  try {
    const u = new URL("/reset-password", base)
    u.searchParams.set("token", token)
    setPasswordUrl = u.toString()
    helpUrl = new URL("/help", base).toString()
  } catch {
    logger.error("issueWelcomeInvite: invalid AUTH_URL, cannot build invite link")
    return false
  }

  try {
    await prisma.user.update({
      // targetGuard miss (target promoted mid-flight) throws P2025 → no send.
      where: { id: user.id, ...targetGuard },
      data: { passwordResetToken: tokenHash, passwordResetExpires: expires },
    })
  } catch (e) {
    logger.error("issueWelcomeInvite: failed to store token", { error: e instanceof Error ? e.message : String(e) })
    return false
  }

  try {
    await sendWelcomeEmail(user.email, { name: user.name, role: ROLE_LABEL[user.role] ?? user.role, setPasswordUrl, helpUrl })
    return true
  } catch (e) {
    logger.error("issueWelcomeInvite: welcome email send failed", { error: e instanceof Error ? e.message : String(e) })
    // The invite link never reached the user, so roll back the stored token —
    // otherwise a usable password-reset credential lingers in the DB for the full
    // TTL with no matching email. Admin can retry via resendWelcome.
    // Scoped to the hash THIS invocation wrote: an overlapping
    // create/resend for the same user may have already replaced the slot with
    // a newer token before this failure handler runs — clearing unconditionally
    // would erase that newer, successfully-sent token. Prisma's extended
    // where-unique lets a non-unique field ride along with `id`; no match
    // (token already rotated) throws P2025, silently swallowed below.
    await prisma.user
      .update({
        where: { id: user.id, passwordResetToken: tokenHash },
        data: { passwordResetToken: null, passwordResetExpires: null },
      })
      .catch(() => {})
    return false
  }
}

export async function createUser(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = CreateUserSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Only ADMIN may mint an elevated (ADMIN or PASTOR) account — block
  // OFFICE_ADMIN self-escalation past the accounting/pastoral boundary.
  if (!canAssignRole(session?.user?.role, parsed.data.role)) {
    return { error: "Unauthorized" }
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (existing) return { error: "Email already in use" }

  // Unusable random password — the account cannot be logged into until the
  // user completes the set-password invite below.
  const passwordHash = await hash(randomBytes(32).toString("hex"), 12)
  let newUser
  try {
    newUser = await prisma.user.create({
      data: { name: parsed.data.name, email: parsed.data.email, passwordHash, role: parsed.data.role },
    })
  } catch (e) {
    // The findUnique check above is check-then-act — a concurrent create can
    // slip in between it and this create() call.
    if (isP2002(e)) return { error: "Email already in use" }
    throw e
  }
  const userId = actorId(session)
  await logAudit(userId, "USER_CREATED", "User", newUser.id, { targetUserId: newUser.id })

  const sent = await issueWelcomeInvite(newUser)
  await logAudit(userId, sent ? "WELCOME_EMAIL_SENT" : "WELCOME_EMAIL_FAILED", "User", newUser.id, {
    targetUserId: newUser.id,
  })

  revalidatePath("/users")
  redirect("/users")
}

type UserUpdateData = {
  name: string
  email: string
  role: UserRole
  passwordHash?: string
  sessionsValidFrom?: Date
  failedLoginAttempts?: number
  lockedUntil?: Date | null
  failedOtpAttempts?: number
  otpLockedUntil?: Date | null
}

async function buildUserUpdateData(parsedData: {
  name: string
  email: string
  role: UserRole
  password?: string
}): Promise<UserUpdateData> {
  const data: UserUpdateData = {
    name: parsedData.name,
    email: parsedData.email,
    role: parsedData.role,
  }
  if (parsedData.password) {
    data.passwordHash = await hash(parsedData.password, 12)
    // Admin-forced password change must terminate the target's live sessions —
    // the change is usually a response to compromise.
    data.sessionsValidFrom = new Date()
    // Clear all four lockout fields, matching the self-service resetPassword
    // path — otherwise an admin resetting the password of a locked-out
    // user leaves lockedUntil/otpLockedUntil in place, so the target still
    // hits AccountLocked until the timer expires or a separate unlockUser call.
    data.failedLoginAttempts = 0
    data.lockedUntil = null
    data.failedOtpAttempts = 0
    data.otpLockedUntil = null
  }
  return data
}

// Demotion's last-admin recount and the write itself run in one Serializable
// transaction — closes the check-then-act race described above the
// assertNotLastAdmin definition. The target role is reloaded INSIDE the
// transaction — otherwise a concurrent promotion between the outer pre-tx
// read and this transaction starting could demote a newly-promoted sole
// admin with no recount ever running (the stale pre-tx role said "not
// ADMIN", so the guard was skipped entirely).
async function applyUserUpdate(
  tx: Prisma.TransactionClient,
  id: number,
  newRole: UserRole,
  data: UserUpdateData
): Promise<void> {
  const current = await tx.user.findUnique({ where: { id }, select: { role: true, archivedAt: true } })
  if (!current || current.archivedAt) throw new TargetGoneError("User not found")
  if (current.role === UserRole.ADMIN && newRole !== UserRole.ADMIN) {
    await assertNotLastAdmin(tx, id, "Cannot remove the last administrator")
  }
  await tx.user.update({ where: { id }, data })
}

// Maps the errors applyUserUpdate's transaction can throw to a clean
// ActionResult message. Returns undefined for anything else, which the
// caller rethrows.
function updateUserErrorMessage(e: unknown): string | undefined {
  if (e instanceof TargetGoneError) return e.message
  if (e instanceof LastAdminError) return e.message
  if (isP2002(e)) return "Email already in use"
  if (isP2034(e)) return "Cannot remove the last administrator — please try again."
  return undefined
}

export async function updateUser(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "User not found" }

  const parsed = UpdateUserSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, archivedAt: true } })
  if (!target || target.archivedAt) return { error: "User not found" }

  // Non-ADMIN actors may not touch an elevated (ADMIN/PASTOR) account, nor grant
  // an elevated role. Editing a PASTOR target also lets a non-ADMIN reset its
  // password → account takeover, so the target's current role is guarded too
  //.
  if (!canAssignRole(session?.user?.role, target.role) || !canAssignRole(session?.user?.role, parsed.data.role)) {
    return { error: "Unauthorized" }
  }

  const existing = await prisma.user.findFirst({
    where: { email: parsed.data.email, NOT: { id } },
  })
  if (existing) return { error: "Email already in use" }

  const data = await buildUserUpdateData(parsed.data)

  // The P2002 catch below is a backstop for the email-collision race: the
  // findFirst check above is itself check-then-act.
  try {
    await prisma.$transaction(
      (tx) => applyUserUpdate(tx, id, parsed.data.role, data),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  } catch (e) {
    const message = updateUserErrorMessage(e)
    if (message) return { error: message }
    throw e
  }
  if (parsed.data.password) {
    await prisma.trustedDevice.deleteMany({ where: { userId: id } })
  }
  const userId = actorId(session)
  await logAudit(userId, "USER_UPDATED", "User", id, {
    targetUserId: id,
    role: parsed.data.role,
    passwordChanged: !!parsed.data.password,
  })
  revalidatePath("/users")
  redirect("/users")
}

export async function unlockUser(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "User not found" }
  if (actorId(session) === id) return { error: "Cannot unlock your own account" }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, archivedAt: true } })
  if (!target || target.archivedAt) return { error: "User not found" }
  if (!canAssignRole(session?.user?.role, target.role)) return { error: "Unauthorized" }

  try {
    await prisma.user.update({
      where: { id, ...assignableTargetWhere(session?.user?.role) },
      // Clear both password and OTP lockout state — leaving the OTP lockout in
      // place re-locks the user at the OTP step with no explanation
      data: { failedLoginAttempts: 0, lockedUntil: null, failedOtpAttempts: 0, otpLockedUntil: null },
    })
  } catch (e) {
    // Target promoted to ADMIN/PASTOR since the pre-read.
    if ((e as { code?: unknown })?.code === "P2025") return { error: "Unauthorized" }
    throw e
  }
  await logAudit(actorId(session), "USER_UNLOCKED", "User", id)
  revalidatePath("/users")
}

export async function deleteUser(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "User not found" }

  const userId = actorId(session)
  if (userId === id) return { error: "Cannot delete your own account" }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, email: true, archivedAt: true } })
  if (!target) return { error: "User not found" }
  if (target.archivedAt) return { error: "User not found" }

  // Non-ADMIN actors may not delete an elevated (ADMIN/PASTOR) account — same
  // target-role gate updateUser uses. Deleting a PASTOR is just as much
  // a privilege breach as deleting an ADMIN (archives the account, tombstones
  // its email, and kills its sessions).
  if (!canAssignRole(session?.user?.role, target.role)) return { error: "Unauthorized" }

  // Soft-delete, not hard delete: every user who has logged in owns
  // append-only AuditLog rows that RESTRICT the FK, so user.delete() throws
  // P2003 and can never satisfy. Archiving preserves the audit trail + actor
  // accountability. We also tombstone the email (email @unique) so the address
  // frees for re-invite, and stamp sessionsValidFrom to kill any live token.
  // Deleting the last ADMIN is on the same lockout path as demotion.
  // Recount + write run in one Serializable transaction. `target`
  // above is read before the transaction only for the authorization check;
  // the recount + tombstone write below reload the target INSIDE the
  // transaction so neither a concurrent promotion (stale pre-tx role)
  // nor a concurrent archive (double-tombstoning the email) can slip past it.
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: { role: true, email: true, archivedAt: true } })
      if (!current || current.archivedAt) throw new TargetGoneError("User not found")
      if (current.role === UserRole.ADMIN) {
        await assertNotLastAdmin(tx, id, "Cannot delete the last administrator")
      }
      await tx.user.update({
        where: { id },
        data: {
          archivedAt: new Date(),
          email: `archived+${id}+${current.email}`,
          sessionsValidFrom: new Date(),
          // Void any outstanding password-reset link so it can't act on the
          // archived account (resetPassword clears lockouts / trusted devices).
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (e) {
    if (e instanceof TargetGoneError) return { error: e.message }
    if (e instanceof LastAdminError) return { error: e.message }
    if (isP2034(e)) {
      return { error: "Cannot delete the last administrator — please try again." }
    }
    throw e
  }
  await logAudit(userId, "USER_DELETED", "User", id)
  revalidatePath("/users")
}

export async function resendWelcome(id: number): Promise<{ success: true } | { error: string }> {
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "User not found" }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, archivedAt: true },
  })
  if (!target || target.archivedAt) return { error: "User not found" }

  // Non-ADMIN actors may not re-issue an invite for an ADMIN or PASTOR account
  // (consistency with the create/update/delete escalation guards).
  if (!canAssignRole(session?.user?.role, target.role)) {
    return { error: "Unauthorized" }
  }

  const sent = await issueWelcomeInvite(target, assignableTargetWhere(session?.user?.role))
  await logAudit(actorId(session), sent ? "WELCOME_EMAIL_SENT" : "WELCOME_EMAIL_FAILED", "User", id, {
    targetUserId: id,
  })
  revalidatePath("/users")
  return sent
    ? { success: true }
    : { error: "Could not send the welcome email. Check email configuration." }
}
