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
import { auditIpFromHeaders } from "@/lib/clientIp"
import { isSetupOpen } from "@/lib/setupState"
import { PASSWORD_REGEX, PASSWORD_MSG } from "@/lib/passwordPolicy"
import { isP2002, isP2034 } from "@/lib/validation"
import { UserRole } from "@/lib/generated/prisma/enums"

const UNAVAILABLE = "Setup is not available."
const SETUP_LIMIT = 10
const SETUP_WINDOW_MS = 15 * 60_000

const SetupSchema = z.object({
  token: z.string().max(256),
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  // Not lower-cased: login looks the email up exactly as typed (same as createUser).
  email: z.string().trim().email("Invalid email").max(254, "Email is too long"),
  password: z.string().max(128, "Password is too long").regex(PASSWORD_REGEX, PASSWORD_MSG),
})

export type SetupField = "token" | "name" | "email" | "password" | "confirm"
type SetupResult = { error: string; field?: SetupField } | { success: true }

class SetupClosedError extends Error {}

export async function createFirstAdmin(formData: FormData): Promise<SetupResult> {
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
  const ip = auditIpFromHeaders(await headers())
  if (!(await dbRateLimit(`setup:${ip ?? "unknown"}`, SETUP_LIMIT, SETUP_WINDOW_MS))) {
    return { error: "Too many attempts. Try again later." }
  }
  // No usable client IP from X-Forwarded-For (no reverse proxy, or a malformed
  // header) → every client shares one bucket, so a stranger's wrong-token
  // attempts can lock the operator out. Server Actions can't see the socket
  // address; warn the operator instead. Logged after the limit so the shared
  // bucket also caps how often this can be written.
  if (!ip) {
    logger.warn("setup: no valid client IP from X-Forwarded-For — all /setup clients share one rate-limit bucket", {
      hint: "run behind a reverse proxy that sets X-Forwarded-For, or use scripts/create-admin-user.ts",
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
        return tx.user.create({
          data: { name: parsed.data.name, email: parsed.data.email, passwordHash, role: UserRole.ADMIN },
          select: { id: true },
        })
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
