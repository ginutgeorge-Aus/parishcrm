"use server"

import { hash } from "bcryptjs"
import { headers } from "next/headers"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { safeEqual } from "@/lib/safeEqual"
import { resolveClientIp } from "@/lib/clientIp"
import { isSetupOpen } from "@/lib/setupState"
import { PASSWORD_REGEX, PASSWORD_MSG } from "@/lib/passwordPolicy"
import { isP2002, isP2034 } from "@/lib/validation"
import { UserRole } from "@/lib/generated/prisma/enums"
import { assertNotDemo } from "@/lib/demoMode"
import { userEmailField } from "@/lib/userLookup"
import { FEATURES_ONBOARDING_KEY } from "@/lib/features"

const UNAVAILABLE = "Setup is not available."
const SETUP_LIMIT = 10
const SETUP_WINDOW_MS = 15 * 60_000

const SetupSchema = z.object({
  token: z.string().max(256),
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  // Shared field: trimmed + lower-cased on write, same as createUser.
  email: userEmailField,
  password: z.string().max(128, "Password is too long").regex(PASSWORD_REGEX, PASSWORD_MSG),
})

export type SetupField = "token" | "name" | "email" | "password" | "confirm"
type SetupResult = { error: string; field?: SetupField } | { success: true }

class SetupClosedError extends Error {}

/**
 * Resolves the caller's IP for `/setup`: `ip` is the validated IP (undefined when none, which
 * triggers the shared-bucket warning), `key` the rate-limit bucket key (validated IP, else
 * "unknown"), consistent with the other limiters.
 * @returns the validated IP and the bucket key
 */
async function setupClientIp(): Promise<{ ip: string | undefined; key: string }> {
  return resolveClientIp(await headers())
}

/**
 * Creates the first ADMIN from the one-time `/setup` form. Gated by the setup token, only open while
 * no users exist, and rate-limited per client IP.
 * @param formData the setup form (token, name, email, password, confirm)
 * @returns `{ success: true }`, or `{ error, field? }`
 */
export async function createFirstAdmin(formData: FormData): Promise<SetupResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  // Closed setup (no SETUP_TOKEN, or users exist) bails before any DB write.
  if (!(await isSetupOpen())) return { error: UNAVAILABLE }

  const parsed = SetupSchema.safeParse({
    token: formData.get("token") ?? "",
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { error: issue.message, field: issue.path[0] as SetupField }
  }

  // Rate-limit only well-formed submissions, so policy typos don't lock the operator out.
  const { ip, key } = await setupClientIp()
  if (!(await dbRateLimit(`setup:${key}`, SETUP_LIMIT, SETUP_WINDOW_MS))) {
    return { error: "Too many attempts. Try again later." }
  }
  // No usable client IP from CLIENT_IP_HEADER or X-Forwarded-For (no reverse proxy, or a malformed
  // header) → every client shares one bucket, so a stranger's wrong-token
  // attempts can lock the operator out. Server Actions can't see the socket
  // address; warn the operator instead. Logged after the limit so the shared
  // bucket also caps how often this can be written.
  if (!ip) {
    logger.warn("setup: no valid client IP from CLIENT_IP_HEADER or X-Forwarded-For — /setup clients without a distinct raw x-forwarded-for entry share one rate-limit bucket", {
      hint: "run behind a reverse proxy that sets X-Forwarded-For (or set CLIENT_IP_HEADER), or use scripts/create-admin-user.ts",
    })
  }

  if (!safeEqual(parsed.data.token, process.env.SETUP_TOKEN ?? "")) {
    return { error: UNAVAILABLE, field: "token" }
  }

  const passwordHash = await hash(parsed.data.password, 12)
  try {
    // Serializable: two concurrent setups both read count=0 then insert — Postgres
    // aborts the loser (P2034), or the email unique index does (P2002).
    const user = await prisma.$transaction(
      async (tx) => {
        if ((await tx.user.count()) > 0) throw new SetupClosedError()
        const created = await tx.user.create({
          data: { name: parsed.data.name, email: parsed.data.email, passwordHash, role: UserRole.ADMIN },
          select: { id: true },
        })
        // First-run prompt: the dashboard sends this admin to Settings → Features
        // until they save or keep the defaults. Existing installs never get it.
        await tx.appSetting.upsert({
          where: { key: FEATURES_ONBOARDING_KEY },
          create: { key: FEATURES_ONBOARDING_KEY, value: "pending" },
          update: { value: "pending" },
        })
        return created
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
    await logAudit(user.id, "SETUP_FIRST_ADMIN", "User", user.id, undefined, ip)
    return { success: true }
  } catch (e) {
    if (e instanceof SetupClosedError || isP2034(e) || isP2002(e)) return { error: UNAVAILABLE }
    throw e
  }
}
