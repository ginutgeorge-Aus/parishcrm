"use server"

import { auth } from "@/auth"
import { logger } from "@/lib/logger"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { hash } from "bcryptjs"
import { randomBytes, createHash } from "node:crypto"
import { prisma, Prisma } from "@/lib/prisma"
import { canManageUsers, canAssignRole, isAdmin } from "@/lib/roleGuard"
import { TOTP_CLEARED } from "@/lib/totp"
import { logAudit, logAuditTx } from "@/lib/audit"
import { auditIpFromHeaders } from "@/lib/clientIp"
import { sendWelcomeEmail } from "@/lib/email"
import { isP2002, isP2034, isValidPgId } from "@/lib/validation"
import { PASSWORD_REGEX, PASSWORD_MSG } from "@/lib/passwordPolicy"
import type { ActionResult } from "./types"
import { UserRole } from "@/lib/generated/prisma/enums"
import { assertNotDemo } from "@/lib/demoMode"
import { ROLE_LABELS } from "@/lib/roleLabels"
import { userEmailField, isEmailTaken, normalizeEmail } from "@/lib/userLookup"

const ROLE_VALUES = Object.values(UserRole) as [UserRole, ...UserRole[]]

// Thrown inside the last-admin-guard transactions below (updateUser/deleteUser)
// to surface a clean ActionResult error instead of an unhandled throw.
class LastAdminError extends Error {}

// Thrown when the target reloaded INSIDE the updateUser/deleteUser
// serializable transaction turns out to be gone or archived — it
// vanished/got archived between the outer pre-transaction check and the
// transaction actually starting. Surfaces the same clean "User not found"
// ActionResult instead of writing over (or double-archiving) a gone user.
class TargetGoneError extends Error {}

// Thrown when the target reloaded INSIDE a transaction holds a role the actor
// may not manage (canAssignRole), e.g. an ADMIN promoted it between the outer
// authorization read and the write. Maps to "Unauthorized" (AUD-1-02b).
class TargetUnauthorizedError extends Error {}

// Thrown when the in-transaction audit row cannot be written. The mutation
// rolls back with it, so an unlogged user/role change never commits (AUD-1-02c).
class AuditWriteError extends Error {
  constructor() {
    super("Could not record this change in the audit log, so nothing was saved. Please try again.")
  }
}

/**
 * Writes the audit row inside the caller's transaction and fails closed: any
 * write error becomes an AuditWriteError, which rolls back the mutation.
 * @param tx interactive-transaction client
 * @param userId acting user
 * @param action audit action code
 * @param targetId the user account acted on
 * @param metadata ids/roles/flags only, never an email address
 * @param ip client IP, when known
 */
async function auditUserTx(
  tx: Prisma.TransactionClient,
  userId: number | null,
  action: string,
  targetId: number,
  metadata: Record<string, unknown>,
  ip: string | undefined,
): Promise<void> {
  try {
    await logAuditTx(tx, userId, action, "User", targetId, metadata, ip)
  } catch (e) {
    // A Serializable conflict (P2034) or unique clash (P2002) surfacing here is a
    // transaction-level error the callers already map (retry prompt / duplicate),
    // not an audit failure — pass it through unwrapped.
    if (isP2034(e) || isP2002(e)) throw e
    logger.error("user action audit write failed", { action, targetId, error: e instanceof Error ? e.message : String(e) })
    throw new AuditWriteError()
  }
}

/**
 * Client IP for the audit row of the current server-action request.
 * @returns the validated IP, or undefined
 */
async function requestAuditIp(): Promise<string | undefined> {
  return auditIpFromHeaders(await headers())
}

/**
 * Maps the errors a guarded single-target write can throw (unlock, TOTP reset,
 * passkey revoke) to an ActionResult message; undefined means rethrow.
 * @param e the caught error
 * @returns the message, or undefined
 */
function targetWriteErrorMessage(e: unknown): string | undefined {
  // P2025: the target moved to a role the actor may not manage since the pre-read.
  if ((e as { code?: unknown })?.code === "P2025") return "Unauthorized"
  if (e instanceof AuditWriteError) return e.message
  // Serializable conflict (also re-thrown unwrapped by auditUserTx): retry prompt.
  if (isP2034(e)) return "Could not complete the change because of a concurrent update — please try again."
  return undefined
}

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

// Email is trimmed + lowercased on write so it matches the normalised login lookup in src/auth.ts.
const CreateUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
  email: userEmailField,
  role: z.enum(ROLE_VALUES),
})

const UpdateUserSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
  email: userEmailField,
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

/**
 * Write-time mirror of canAssignRole's target check: ride this on the
 * mutation's where-unique so a concurrent promotion to a role the actor may not
 * manage (ADMIN, PASTOR, or the actor's own role) between the authorization
 * pre-read and the write makes the write miss (P2025) instead of acting on that
 * account. ADMIN actors are unrestricted.
 * @param actorRole the signed-in user's role
 * @returns a where-unique fragment
 */
function assignableTargetWhere(actorRole: UserRole | undefined) {
  if (isAdmin(actorRole)) return {}
  return { role: { notIn: ROLE_VALUES.filter((r) => !canAssignRole(actorRole, r)) } }
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
    await sendWelcomeEmail(user.email, { name: user.name, role: ROLE_LABELS[user.role] ?? user.role, setPasswordUrl, helpUrl })
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

/**
 * Creates a user account (ADMIN, or OFFICE_ADMIN for non-ADMIN roles) from the user-management form.
 * @param _prev previous action state (unused; required by `useActionState`)
 * @param formData the new user's fields
 * @returns the `ActionResult`
 */
export async function createUser(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = CreateUserSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Only ADMIN may mint an elevated (ADMIN or PASTOR) account — block
  // OFFICE_ADMIN self-escalation past the accounting/pastoral boundary.
  if (!canAssignRole(session?.user?.role, parsed.data.role)) {
    return { error: "Unauthorized" }
  }

  // Case-insensitive: legacy rows may be stored mixed-case, and login matches insensitively.
  if (await isEmailTaken(parsed.data.email)) return { error: "Email already in use" }

  // Unusable random password — the account cannot be logged into until the
  // user completes the set-password invite below.
  const passwordHash = await hash(randomBytes(32).toString("hex"), 12)
  const userId = actorId(session)
  const ip = await requestAuditIp()
  let newUser
  try {
    // Create + audit commit together: a failed audit write rolls the account back.
    newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: parsed.data.name, email: parsed.data.email, passwordHash, role: parsed.data.role },
      })
      await auditUserTx(tx, userId, "USER_CREATED", created.id, { targetUserId: created.id, toRole: parsed.data.role }, ip)
      return created
    })
  } catch (e) {
    // The isEmailTaken check above is check-then-act — a concurrent create can
    // slip in between it and this create() call.
    if (isP2002(e)) return { error: "Email already in use" }
    if (e instanceof AuditWriteError) return { error: e.message }
    throw e
  }

  const sent = await issueWelcomeInvite(newUser)
  await logAudit(userId, sent ? "WELCOME_EMAIL_SENT" : "WELCOME_EMAIL_FAILED", "User", newUser.id, {
    targetUserId: newUser.id,
  })

  revalidatePath("/users")
  redirect("/users")
}

type UserUpdateData = {
  name: string
  // email/role are absent on a self-edit (name only).
  email?: string
  role?: UserRole
  passwordHash?: string
  sessionsValidFrom?: Date
  failedLoginAttempts?: number
  lockedUntil?: Date | null
  failedOtpAttempts?: number
  otpLockedUntil?: Date | null
}

/**
 * Builds the admin-edit write from the parsed form: name, email, role, and on a
 * new password the hash plus session/lockout resets. Email/role-change
 * credential invalidation is added in applyUserUpdate against the
 * in-transaction row.
 * @param parsedData the validated form fields
 * @returns the update data
 */
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
/**
 * Reloads the target inside the Serializable transaction, re-checks that the
 * actor may manage its CURRENT role (AUD-1-02b), runs the last-admin guard, and
 * writes the update. An email change voids any outstanding reset link and OTP
 * code and ends live sessions; a role change ends live sessions (AUD-1-02d).
 * @param tx interactive-transaction client
 * @param id the target user
 * @param data the write built by buildUserUpdateData (name only on a self-edit)
 * @param actorRole the signed-in user's role
 * @param isSelf true when the actor edits their own account (role re-check skipped)
 * @returns the old and new role and whether the email changed, for the audit row
 */
async function applyUserUpdate(
  tx: Prisma.TransactionClient,
  id: number,
  data: UserUpdateData,
  actorRole: UserRole | undefined,
  isSelf: boolean,
): Promise<{ fromRole: UserRole; toRole: UserRole; emailChanged: boolean }> {
  const current = await tx.user.findUnique({ where: { id }, select: { role: true, email: true, archivedAt: true } })
  if (!current || current.archivedAt) throw new TargetGoneError("User not found")
  if (!isSelf && !canAssignRole(actorRole, current.role)) throw new TargetUnauthorizedError("Unauthorized")
  const toRole = data.role ?? current.role
  if (current.role === UserRole.ADMIN && toRole !== UserRole.ADMIN) {
    await assertNotLastAdmin(tx, id, "Cannot remove the last administrator")
  }
  // data.email is already normalised; a case-only difference is not a change.
  const emailChanged = data.email !== undefined && data.email !== normalizeEmail(current.email)
  const roleChanged = toRole !== current.role
  const write: Prisma.UserUpdateInput = { ...data }
  if (emailChanged) {
    // A reset link or OTP code already mailed to the old address must not keep working.
    write.passwordResetToken = null
    write.passwordResetExpires = null
    write.otpCode = null
    write.otpExpiresAt = null
  }
  if (emailChanged || roleChanged) write.sessionsValidFrom = new Date()
  await tx.user.update({ where: { id }, data: write })
  return { fromRole: current.role, toRole, emailChanged }
}

// Maps the errors applyUserUpdate's transaction can throw to a clean
// ActionResult message. Returns undefined for anything else, which the
// caller rethrows.
function updateUserErrorMessage(e: unknown): string | undefined {
  if (e instanceof TargetGoneError) return e.message
  if (e instanceof TargetUnauthorizedError) return e.message
  if (e instanceof AuditWriteError) return e.message
  if (e instanceof LastAdminError) return e.message
  if (isP2002(e)) return "Email already in use"
  if (isP2034(e)) return "Cannot remove the last administrator — please try again."
  return undefined
}

/**
 * Updates a user's name, email, role and active state from the user-management form.
 * @param id the user to update
 * @param _prev previous action state (unused; required by `useActionState`)
 * @param formData the edited fields
 * @returns the `ActionResult`
 */
export async function updateUser(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "User not found" }

  const parsed = UpdateUserSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, email: true, archivedAt: true } })
  if (!target || target.archivedAt) return { error: "User not found" }

  const userId = actorId(session)
  const isSelf = userId === id
  if (isSelf) {
    // Self-edit here is name only: changing your own email, role or password
    // from the admin form would skip the checks the account flows apply.
    if (parsed.data.email !== normalizeEmail(target.email) || parsed.data.role !== target.role || parsed.data.password) {
      return {
        error:
          "You can only change your own name here. To change your password, use “Forgot password” on the sign-in page; ask another administrator to change your email or role.",
      }
    }
  } else if (!canAssignRole(session?.user?.role, target.role) || !canAssignRole(session?.user?.role, parsed.data.role)) {
    // Non-ADMIN actors may not touch an account they cannot manage (ADMIN,
    // PASTOR, or a peer OFFICE_ADMIN), nor grant such a role. Editing one lets
    // the actor reset its email/password → account takeover, so the target's
    // current role is guarded too (AUD-1-02).
    return { error: "Unauthorized" }
  }

  // parsed.data.email is already normalised (trimmed + lower-cased) and is what we
  // persist, so a case-only edit (or any save of a legacy mixed-case row) stores the
  // normalised form. Only a real change (beyond case) can collide with ANOTHER user,
  // so skip the duplicate check when the normalised stored email is the same.
  if (normalizeEmail(target.email) !== parsed.data.email && (await isEmailTaken(parsed.data.email, id))) {
    return { error: "Email already in use" }
  }

  const data: UserUpdateData = isSelf ? { name: parsed.data.name } : await buildUserUpdateData(parsed.data)
  const ip = await requestAuditIp()

  // The P2002 catch below is a backstop for the email-collision race: the
  // isEmailTaken check above is itself check-then-act.
  try {
    await prisma.$transaction(
      async (tx) => {
        const change = await applyUserUpdate(tx, id, data, session?.user?.role, isSelf)
        if (data.passwordHash) {
          // Trusted devices skip OTP and passkeys bypass the password entirely, so
          // a forced password change drops both — in the same transaction, so a
          // failed delete can't leave them alive behind a committed new password.
          await tx.trustedDevice.deleteMany({ where: { userId: id } })
          await tx.passkey.deleteMany({ where: { userId: id } })
        }
        // Same transaction: a failed audit write rolls the update back. No
        // email addresses in metadata, only whether it changed.
        await auditUserTx(tx, userId, "USER_UPDATED", id, {
          targetUserId: id,
          fromRole: change.fromRole,
          toRole: change.toRole,
          emailChanged: change.emailChanged,
          passwordChanged: data.passwordHash !== undefined,
        }, ip)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  } catch (e) {
    const message = updateUserErrorMessage(e)
    if (message) return { error: message }
    throw e
  }
  revalidatePath("/users")
  redirect("/users")
}

/**
 * Clears a user's password and OTP lockouts (admin unlock), audited in the same transaction.
 * @param id the user to unlock
 * @returns the `ActionResult`
 */
export async function unlockUser(id: number): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "User not found" }
  if (actorId(session) === id) return { error: "Cannot unlock your own account" }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, archivedAt: true } })
  if (!target || target.archivedAt) return { error: "User not found" }
  if (!canAssignRole(session?.user?.role, target.role)) return { error: "Unauthorized" }

  const ip = await requestAuditIp()
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id, ...assignableTargetWhere(session?.user?.role) },
        // Clear both password and OTP lockout state — leaving the OTP lockout in
        // place re-locks the user at the OTP step with no explanation
        data: { failedLoginAttempts: 0, lockedUntil: null, failedOtpAttempts: 0, otpLockedUntil: null },
        select: { role: true },
      })
      await auditUserTx(tx, actorId(session), "USER_UNLOCKED", id, { targetUserId: id, targetRole: updated?.role ?? target.role }, ip)
    })
  } catch (e) {
    const message = targetWriteErrorMessage(e)
    if (message) return { error: message }
    throw e
  }
  revalidatePath("/users")
}

/**
 * Lost-phone recovery: clears a user's authenticator, backup codes, trusted
 * devices and passkeys and ends their sessions, audited in the same transaction.
 * @param id the user to reset
 * @returns the `ActionResult`
 */
export async function resetUserTotp(id: number): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "User not found" }
  if (actorId(session) === id) return { error: "Use My Account to manage your own authenticator" }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, archivedAt: true } })
  if (!target || target.archivedAt) return { error: "User not found" }
  if (!canAssignRole(session?.user?.role, target.role)) return { error: "Unauthorized" }

  const ip = await requestAuditIp()
  try {
    // Lost-phone recovery: drop the authenticator, every backup code, and every
    // trusted device (a device trusted by whoever holds the phone must not keep
    // skipping the second factor), plus every live session (the lost device may
    // already be signed in). Next login falls back to email OTP.
    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id, ...assignableTargetWhere(session?.user?.role) },
        data: { ...TOTP_CLEARED, sessionsValidFrom: new Date() },
        select: { role: true },
      })
      await tx.backupCode.deleteMany({ where: { userId: id } })
      await tx.trustedDevice.deleteMany({ where: { userId: id } })
      // A lost phone usually holds a passkey too.
      await tx.passkey.deleteMany({ where: { userId: id } })
      await auditUserTx(tx, actorId(session), "TOTP_RESET", id, { targetUserId: id, targetRole: updated?.role ?? target.role }, ip)
    })
  } catch (e) {
    const message = targetWriteErrorMessage(e)
    if (message) return { error: message }
    throw e
  }
  revalidatePath("/users")
}

/**
 * Lost/stolen device: deletes a user's passkeys and trusted devices and ends
 * their sessions, audited in the same transaction.
 * @param id the user whose passkeys are revoked
 * @returns the `ActionResult`
 */
export async function revokeUserPasskeys(id: number): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "User not found" }
  if (actorId(session) === id) return { error: "Use My Account to manage your own passkeys" }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, archivedAt: true } })
  if (!target || target.archivedAt) return { error: "User not found" }
  if (!canAssignRole(session?.user?.role, target.role)) return { error: "Unauthorized" }

  const ip = await requestAuditIp()
  try {
    // Lost/stolen device: drop every passkey and kill live sessions (the device
    // may already be signed in). Password + OTP/TOTP still work.
    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id, ...assignableTargetWhere(session?.user?.role) },
        data: { sessionsValidFrom: new Date() },
        select: { role: true },
      })
      await tx.passkey.deleteMany({ where: { userId: id } })
      // Trusted devices skip OTP after the password; the lost device may hold one.
      await tx.trustedDevice.deleteMany({ where: { userId: id } })
      await auditUserTx(tx, actorId(session), "PASSKEYS_REVOKED", id, { targetUserId: id, targetRole: updated?.role ?? target.role }, ip)
    })
  } catch (e) {
    const message = targetWriteErrorMessage(e)
    if (message) return { error: message }
    throw e
  }
  revalidatePath("/users")
}

/**
 * Soft-deletes (archives) a user, audited in the same transaction.
 * @param id the user to archive
 * @returns the `ActionResult`
 */
export async function deleteUser(id: number): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
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
  const ip = await requestAuditIp()
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: { role: true, email: true, archivedAt: true } })
      if (!current || current.archivedAt) throw new TargetGoneError("User not found")
      // Re-check against the reloaded role: a concurrent promotion must not let
      // a non-ADMIN archive an account it can no longer manage (AUD-1-02b).
      if (!canAssignRole(session?.user?.role, current.role)) throw new TargetUnauthorizedError("Unauthorized")
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
      await auditUserTx(tx, userId, "USER_DELETED", id, { targetUserId: id, fromRole: current.role }, ip)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (e) {
    if (e instanceof TargetGoneError) return { error: e.message }
    if (e instanceof TargetUnauthorizedError) return { error: e.message }
    if (e instanceof AuditWriteError) return { error: e.message }
    if (e instanceof LastAdminError) return { error: e.message }
    if (isP2034(e)) {
      return { error: "Cannot delete the last administrator — please try again." }
    }
    throw e
  }
  revalidatePath("/users")
}

/**
 * Re-issues the set-password invite for a user who has never signed in.
 * Someone who has signed in uses "Forgot password" instead, so this cannot
 * mint a fresh 7-day reset link for an account already in use. Best effort:
 * "has signed in" is read from USER_LOGIN audit rows, which login writes
 * fire-and-forget (User has no durable last-login column), so a login whose
 * audit write failed still allows a re-invite. The re-invite is itself
 * role-guarded and audited (WELCOME_EMAIL_SENT).
 * @param id the user to re-invite
 * @returns success, or an error message
 */
export async function resendWelcome(id: number): Promise<{ success: true } | { error: string }> {
  const demo = assertNotDemo()
  if (demo) return demo
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

  // A USER_LOGIN audit row means the account is already in use (AUD-1-02d).
  const signedIn = await prisma.auditLog.findFirst({ where: { userId: id, action: "USER_LOGIN" }, select: { id: true } })
  if (signedIn) {
    return { error: "This user has already signed in. Ask them to use “Forgot password” on the sign-in page instead." }
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
