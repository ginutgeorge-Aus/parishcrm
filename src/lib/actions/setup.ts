"use server"

import { hash } from "bcryptjs"
import { headers } from "next/headers"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { safeEqual } from "@/lib/cronAuth"
import { PASSWORD_REGEX, PASSWORD_MSG } from "@/lib/passwordPolicy"
import { UserRole } from "@/lib/generated/prisma/enums"

const UNAVAILABLE = "Setup is not available."
// Arbitrary constant key — serialises concurrent first-admin creation.
const SETUP_LOCK_KEY = 7_331_001
const SETUP_LIMIT = 10
const SETUP_WINDOW_MS = 15 * 60_000

const SetupSchema = z.object({
  token: z.string().max(256),
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  email: z.string().trim().toLowerCase().email("Invalid email").max(254, "Email is too long"),
  password: z.string().max(128, "Password is too long").regex(PASSWORD_REGEX, PASSWORD_MSG),
})

async function clientIp(): Promise<string | null> {
  const xff = (await headers()).get("x-forwarded-for")
  // Rightmost IP is appended by the trusted reverse proxy — not client-spoofable.
  return xff?.split(",").at(-1)?.trim() || null
}

class SetupClosedError extends Error {}

export async function createFirstAdmin(
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const ip = await clientIp()
  if (!(await dbRateLimit(`setup:${ip ?? "unknown"}`, SETUP_LIMIT, SETUP_WINDOW_MS))) {
    return { error: "Too many attempts. Try again later." }
  }

  const parsed = SetupSchema.safeParse({
    token: formData.get("token") ?? "",
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const secret = process.env.SETUP_TOKEN ?? ""
  if (!safeEqual(parsed.data.token, secret)) return { error: UNAVAILABLE }

  const passwordHash = await hash(parsed.data.password, 12)
  try {
    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`
      if ((await tx.user.count()) > 0) throw new SetupClosedError()
      return tx.user.create({
        data: { name: parsed.data.name, email: parsed.data.email, passwordHash, role: UserRole.ADMIN },
        select: { id: true },
      })
    })
    await logAudit(user.id, "SETUP_FIRST_ADMIN", "User", user.id, undefined, ip ?? undefined)
    return { success: true }
  } catch (e) {
    if (e instanceof SetupClosedError) return { error: UNAVAILABLE }
    throw e
  }
}
