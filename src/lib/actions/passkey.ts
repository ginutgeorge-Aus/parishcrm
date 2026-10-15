"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { compare } from "bcryptjs"
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { actorId } from "@/lib/actor"
import { sendEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { logger } from "@/lib/logger"
import { auditIpFromHeaders } from "@/lib/clientIp"
import { assertNotDemo, isDemoMode } from "@/lib/demoMode"
import {
  MAX_PASSKEYS_PER_USER, consumeChallenge, createChallenge, getRelyingParty, normalisePasskeyName,
} from "@/lib/webauthn"

type PasskeySummary = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null; backedUp: boolean }
export type PasskeyStatus = { available: boolean; limit: number; passkeys: PasskeySummary[] }

const UNAUTHORIZED = { error: "Unauthorized" } as const
const UNAVAILABLE = { error: "Passkeys are not available on this server" } as const
const EXPIRED = { error: "Passkey request expired — try again" } as const
const NOT_VERIFIED = { error: "Passkey could not be verified" } as const
const RATE_LIMITED = { error: "Too many attempts. Try again in 15 minutes." } as const
const REAUTH_FAILED = { error: "Incorrect password" } as const
const AT_CAP = { error: `You can register up to ${MAX_PASSKEYS_PER_USER} passkeys` } as const

// Every management action acts on the session user only — no userId argument,
// so there is no IDOR surface. Admin revoke lives in user.ts::revokeUserPasskeys.
async function sessionUserId(): Promise<number | null> {
  const session = await auth()
  try {
    return actorId(session)
  } catch {
    return null
  }
}

// Security notice after a passkey is added/removed. Best-effort: a mail failure
// must never fail the (already committed) action; log the user id, never the address.
async function notifyPasskeyChange(userId: number, to: string | null | undefined, added: boolean, name: string): Promise<void> {
  if (!to) return
  try {
    const churchName = await getChurchName()
    const verb = added ? "added to" : "removed from"
    const text = `A passkey ("${name}") was ${verb} your account. If this wasn't you, contact your administrator.`
    const html = `<p>A passkey (<strong>${escapeHtml(name)}</strong>) was ${verb} your account on ${escapeHtml(churchName)}.</p><p>If this wasn't you, contact your administrator.</p>`
    await sendEmail(to, `Passkey ${added ? "added" : "removed"} — ${churchName}`, html, `${text}\n${churchName}`)
  } catch (err: unknown) {
    logger.error("passkey change notice failed", { userId, err: err instanceof Error ? err.name : "unknown" })
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export async function getPasskeyStatus(): Promise<PasskeyStatus> {
  const userId = await sessionUserId()
  if (!userId) return { available: false, limit: MAX_PASSKEYS_PER_USER, passkeys: [] }
  const passkeys = await prisma.passkey.findMany({
    where: { userId },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, backedUp: true },
    orderBy: { createdAt: "asc" },
  })
  // Demo mode blocks registration, so don't offer it.
  return { available: getRelyingParty() !== null && !isDemoMode(), limit: MAX_PASSKEYS_PER_USER, passkeys }
}

export async function startPasskeyRegistration(
  password: string,
): Promise<{ error: string } | { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  const rp = getRelyingParty()
  if (!rp) return UNAVAILABLE
  if (!(await dbRateLimit(`passkey:manage:${userId}`, 5, 15 * 60_000))) return RATE_LIMITED
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, passwordHash: true, archivedAt: true },
  })
  if (!user || user.archivedAt) return UNAUTHORIZED
  // Re-auth: a hijacked session alone must not be able to plant a persistent
  // passkey. Rate-limited above, so this can't be used to guess the password.
  if (typeof password !== "string" || !password || !(await compare(password, user.passwordHash))) {
    return REAUTH_FAILED
  }
  const existing = await prisma.passkey.findMany({ where: { userId }, select: { credentialId: true, transports: true } })
  if (existing.length >= MAX_PASSKEYS_PER_USER) return AT_CAP

  const options = await generateRegistrationOptions({
    rpName: await getChurchName(),
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(String(userId)),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  })
  const challengeId = await createChallenge(options.challenge, "register", userId)
  return { challengeId, options }
}

export async function finishPasskeyRegistration(
  challengeId: string,
  response: unknown,
  name: string,
): Promise<{ error: string } | { success: true }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  const rp = getRelyingParty()
  if (!rp) return UNAVAILABLE
  const cleanName = normalisePasskeyName(name)
  if (!cleanName) return { error: "Name must be 1–50 characters" }
  const expectedChallenge = await consumeChallenge(challengeId, "register", userId)
  if (!expectedChallenge) return EXPIRED

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    })
  } catch {
    return NOT_VERIFIED
  }
  if (!verification.verified || !verification.registrationInfo) return NOT_VERIFIED

  // Re-check: two registrations started in parallel could both pass the start-time cap.
  if ((await prisma.passkey.count({ where: { userId } })) >= MAX_PASSKEYS_PER_USER) return AT_CAP

  const { credential, credentialBackedUp } = verification.registrationInfo
  let created: { id: string }
  try {
    created = await prisma.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        name: cleanName,
        backedUp: credentialBackedUp,
      },
      select: { id: true },
    })
  } catch (e) {
    if ((e as { code?: unknown })?.code === "P2002") return { error: "This passkey is already registered" }
    throw e
  }

  await logAudit(userId, "PASSKEY_REGISTERED", "User", userId, { passkeyId: created.id })
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  await notifyPasskeyChange(userId, user?.email, true, cleanName)
  revalidatePath("/account")
  return { success: true }
}

export async function removePasskey(id: string): Promise<{ error: string } | { success: true }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const userId = await sessionUserId()
  if (!userId) return UNAUTHORIZED
  // Bound the client-supplied id; the userId scope below is the real ownership
  // guard — another user's id deletes nothing.
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return { error: "Passkey not found" }
  const row = await prisma.passkey.findFirst({ where: { id, userId }, select: { name: true, user: { select: { email: true } } } })
  if (!row) return { error: "Passkey not found" }
  // count re-checks ownership/existence at delete time (a concurrent remove wins once).
  const { count } = await prisma.passkey.deleteMany({ where: { id, userId } })
  if (count === 0) return { error: "Passkey not found" }

  await logAudit(userId, "PASSKEY_REMOVED", "User", userId, { passkeyId: id })
  await notifyPasskeyChange(userId, row.user.email, false, row.name)
  revalidatePath("/account")
  return { success: true }
}

// Public (pre-login): issues a usernameless challenge — the browser offers every
// passkey it holds for this RP and the server resolves the user from the
// credential in authorizeCredentials. Per-IP throttled, skipped under
// E2E_ALLOW_TEST_OVERRIDES for the same reason as the credentials path.
export async function startPasskeyLogin(): Promise<
  { error: string } | { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }
> {
  const demo = assertNotDemo()
  if (demo) return { error: "Passkeys are not available in the demo" }
  const rp = getRelyingParty()
  if (!rp) return UNAVAILABLE
  const ip = auditIpFromHeaders(await headers())
  if (
    process.env.E2E_ALLOW_TEST_OVERRIDES !== "true" &&
    !(await dbRateLimit(`passkey:login:ip:${ip ?? "unknown"}`, 10, 60_000))
  ) {
    return { error: "Too many attempts. Try again shortly." }
  }
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required", allowCredentials: [] })
  const challengeId = await createChallenge(options.challenge, "login", null)
  return { challengeId, options }
}
