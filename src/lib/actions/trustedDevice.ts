"use server"

import { cookies, headers } from "next/headers"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isValidPgId } from "@/lib/validation"
import { logAudit } from "@/lib/audit"
import {
  DEVICE_TRUST_GRANT_PREFIX,
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_TTL_MS,
  generateDeviceToken,
  hashDeviceToken,
} from "@/lib/trustedDevice"

const secureCookie =
  process.env.NODE_ENV === "production" && process.env.E2E_ALLOW_TEST_OVERRIDES !== "true"

// Called by LoginForm after a successful OTP verify when "Remember this device"
// was checked. authorize() can't set response cookies, so the write happens here
// against the freshly-authenticated session.
export async function trustDevice(): Promise<{ success: true } | { error: string }> {
  const session = await auth()
  // Number() (not parseInt) is deliberate: it rejects trailing-junk ids like
  // "7junk" as NaN, which isValidPgId then fails, instead of coercing to 7.
  const id = Number(session?.user?.id)
  const grantId = session?.deviceTrustGrant
  if (!isValidPgId(id) || !grantId) return { error: "Unauthorized" }

  const token = generateDeviceToken()
  const ua = (await headers()).get("user-agent")?.slice(0, 200) ?? null

  // The conditional update is the single-use boundary: concurrent/replayed
  // calls cannot exchange an expired, consumed, or another user's grant.
  const { count } = await prisma.trustedDevice.updateMany({
    where: {
      id: grantId,
      userId: id,
      tokenHash: { startsWith: DEVICE_TRUST_GRANT_PREFIX },
      expiresAt: { gt: new Date() },
    },
    data: {
      tokenHash: hashDeviceToken(token),
      label: ua,
      expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS),
    },
  })

  if (count !== 1) return { error: "Unauthorized" }

  // Trusting a device grants a 14-day OTP-bypass — a security-boundary action
  // that must leave a forensic trail like every other auth control.
  // resourceId is int-typed; the device id is a cuid, so carry it in metadata.
  await logAudit(id, "TRUSTED_DEVICE_GRANTED", "TrustedDevice", undefined, { deviceId: grantId })

  ;(await cookies()).set(TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(TRUSTED_DEVICE_TTL_MS / 1000),
  })

  return { success: true }
}

export async function revokeTrustedDevice(id: string): Promise<{ success: true } | { error: string }> {
  const session = await auth()
  const userId = session?.user?.id ? parseInt(session.user.id, 10) : NaN
  if (!isValidPgId(userId)) return { error: "Unauthorized" }
  // Bound the client-supplied id before the query (project convention: bound all
  // inputs). cuid ids are short; reject anything implausibly long. The userId
  // scope below is the real ownership guard — another user's id deletes nothing.
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return { error: "Invalid device" }
  await prisma.trustedDevice.deleteMany({ where: { id, userId } })
  await logAudit(userId, "TRUSTED_DEVICE_REVOKED", "TrustedDevice", undefined, { deviceId: id })
  return { success: true }
}

export async function listTrustedDevices(): Promise<
  Array<{ id: string; label: string | null; createdAt: Date; lastUsedAt: Date }>
> {
  const session = await auth()
  const userId = session?.user?.id ? parseInt(session.user.id, 10) : NaN
  if (!isValidPgId(userId)) return []
  return prisma.trustedDevice.findMany({
    where: { userId, NOT: { tokenHash: { startsWith: DEVICE_TRUST_GRANT_PREFIX } } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  })
}
