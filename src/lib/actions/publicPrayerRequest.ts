"use server"

// Public prayer request form (#702, part of #305). No login: abuse is bounded
// by a honeypot field, a generous in-memory per-IP throttle (before any DB
// work) and a per-IP Postgres quota spent only on a valid submission. Turnstile
// is tracked separately. The request is stored as source PUBLIC_FORM, visible
// only to ADMIN | PASTOR; "OK to share" records the requester's consent. The
// request text and contact details are encrypted at rest; the audit row carries
// ids/flags only (no IP, no text).

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { logAuditTx } from "@/lib/audit"
import { resolveClientIp } from "@/lib/clientIp"
import { logger } from "@/lib/logger"
import { encrypt } from "@/lib/crypto"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { PrayerRequestSource } from "@/lib/generated/prisma/enums"
import { PRAYER_REQUESTS_PATH } from "@/lib/pastoralAccess"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rateLimit"
import { isValidEmail } from "@/lib/validation"
import type { ActionResultWithSuccess } from "./types"

const REQUEST_MAX = 4000
const NAME_MAX = 120
const PHONE_MAX = 30
const TOO_MANY = "Too many submissions. Please try again later."
const NO_IP = "We can't accept prayer requests right now. Please contact the parish office."
const TOO_FAST = "That was very quick. Please check your request and send it again."
/** A person needs longer than this between opening the form and sending it. */
const MIN_FILL_MS = 3_000
/** Shown for a real submit and for a silently dropped bot, so a bot can't tell them apart. */
const THANKS = "Thank you. Your prayer request has been received."

/** Trimmed optional string; blank becomes null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .nullish()
    .transform((v) => v || null)

const PublicPrayerSchema = z.object({
  request: z
    .string()
    .trim()
    .min(1, "Enter your prayer request")
    .max(REQUEST_MAX, `Request must be ${REQUEST_MAX} characters or fewer`),
  requesterName: optionalText(NAME_MAX, "Name"),
  requesterEmail: optionalText(254, "Email").refine((v) => v === null || isValidEmail(v), "Enter a valid email"),
  requesterPhone: optionalText(PHONE_MAX, "Phone"),
  shareConsent: z.boolean().optional().default(false),
})

export type PublicPrayerRequestInput = {
  request: string
  requesterName?: string | null
  requesterEmail?: string | null
  requesterPhone?: string | null
  /** The "OK to share" tick. */
  shareConsent?: boolean
  /** Honeypot: hidden from people, so any value means a bot. Named non-semantically so autofill ignores it. */
  hp_field?: string
  /** `Date.now()` when the form was opened; a too-quick submit is refused. Unsigned, so a speed bump only. */
  openedAt?: number
}

/**
 * Submit a prayer request from the public form. Order: honeypot (silent drop,
 * same success text) → trusted-IP check (fail closed) → time-to-submit → in-memory per-IP throttle → validation → per-IP DB
 * quota (5 per hour) → create. Creates a PUBLIC_FORM request, private unless
 * the requester ticked "OK to share".
 * @param input form fields plus the honeypot `hp_field` and `openedAt`
 * @returns `{ success }` or `{ error }`
 */
export async function submitPublicPrayerRequest(input: PublicPrayerRequestInput): Promise<ActionResultWithSuccess> {
  // Honeypot: a hidden field only a bot fills. Answer like a success, store nothing.
  if (typeof input?.hp_field === "string" && input.hp_field.trim().length > 0) return { success: THANKS }

  const { ip, key: rateKey } = resolveClientIp(await headers())
  // No trusted client IP: every such caller would share one "unknown" bucket, so
  // one bot could lock everyone out. Fail closed instead.
  if (!ip) {
    logger.warn("publicPrayerRequest: no valid client IP from CLIENT_IP_HEADER or X-Forwarded-For; refusing submission")
    return { error: NO_IP }
  }
  if (typeof input.openedAt === "number" && Date.now() - input.openedAt < MIN_FILL_MS) return { error: TOO_FAST }
  if (!rateLimit(`prayer:pre:${rateKey}`, 30, 60_000)) return { error: TOO_MANY }

  const parsed = PublicPrayerSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  if (!(await dbRateLimit(`prayer:ip:${rateKey}`, 5, 60 * 60 * 1000))) return { error: TOO_MANY }

  await prisma.$transaction(async (tx) => {
    const created = await tx.prayerRequest.create({
      data: {
        source: PrayerRequestSource.PUBLIC_FORM,
        request: encrypt(d.request),
        requesterName: d.requesterName ? encrypt(d.requesterName) : null,
        requesterEmail: d.requesterEmail ? encrypt(d.requesterEmail) : null,
        requesterPhone: d.requesterPhone ? encrypt(d.requesterPhone) : null,
        shareConsent: d.shareConsent,
        shareConsentAt: d.shareConsent ? new Date() : null,
      },
      select: { id: true },
    })
    await logAuditTx(tx, null, "PRAYER_REQUEST_CREATED", "PrayerRequest", created.id, {
      source: PrayerRequestSource.PUBLIC_FORM,
      shareConsent: d.shareConsent,
    })
  })
  revalidatePath(PRAYER_REQUESTS_PATH)
  return { success: THANKS }
}
