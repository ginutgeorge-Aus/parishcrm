"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { isAdmin } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { revalidatePath, revalidateTag, updateTag } from "next/cache"
import { z } from "zod"

import type { ActionResultWithSuccess } from "./types"

import { IDLE_TIMEOUT_OPTIONS_LIST } from "@/lib/settingsConstants"
import { sendEmail } from "@/lib/email"
import { pronouns } from "@/lib/pronouns"
import { DEFAULT_BIRTHDAY_TEMPLATE, renderBirthdayEmail, type BirthdayTemplate } from "@/lib/birthdayTemplate"
import { DEFAULT_ANNIVERSARY_TEMPLATE, renderAnniversaryEmail, type AnniversaryTemplate } from "@/lib/anniversaryTemplate"
import { getChurchSettings } from "@/lib/churchSettings"
import { LETTER_SETTING_KEYS } from "@/lib/letterSettings"
import { AUTO_EMAIL_KEYS, readAutoEmailFlags, type AutoEmailFlags } from "@/lib/celebrationSettings"

// Single source of truth for every key any settings action may write.
const CHURCH_INFO_KEYS = ["churchName", "churchAddress", "churchABN", "churchEmail", "churchWebsite"] as const
const BIRTHDAY_TEMPLATE_KEYS = ["birthdayEmailSubject", "birthdayEmailBody"] as const
const ANNIVERSARY_TEMPLATE_KEYS = ["anniversaryEmailSubject", "anniversaryEmailBody"] as const
const LETTER_KEY_SET = new Set<string>(LETTER_SETTING_KEYS)

const ALLOWED_KEYS = new Set<string>([
  "ownerNotificationEmail",
  "membershipSecretaryEmail",
  "SESSION_IDLE_TIMEOUT_MINUTES",
  "pettyCashDefaultCustodianId",
  "cardFeePercent",
  "cardFeeFixed",
  ...CHURCH_INFO_KEYS,
  ...BIRTHDAY_TEMPLATE_KEYS,
  ...ANNIVERSARY_TEMPLATE_KEYS,
  ...AUTO_EMAIL_KEYS,
  ...LETTER_SETTING_KEYS,
])
const IDLE_TIMEOUT_OPTIONS = new Set(IDLE_TIMEOUT_OPTIONS_LIST.map(String))
const EMAIL_KEYS = new Set(["ownerNotificationEmail", "churchEmail"])
// Numeric-valued settings and their sane bounds. Card surcharge rate: a blended
// domestic percent + a fixed AUD component. Reader lives in cardFeeSettings.ts
// (cached, busted via the "card-fee" tag below).
const NUMERIC_KEY_BOUNDS: Record<string, { min: number; max: number }> = {
  cardFeePercent: { min: 0, max: 10 },
  cardFeeFixed: { min: 0, max: 5 },
}
// The card-fee keys ARE the numeric keys — derive rather than maintain a
// second list that must stay in sync.
const CARD_FEE_KEYS = new Set(Object.keys(NUMERIC_KEY_BOUNDS))
// Keys that accept a comma-separated list of recipients (nodemailer `to` takes a
// comma-joined string). Membership alerts can go to several people (#secretary + admin).
const MULTI_EMAIL_KEYS = new Set(["membershipSecretaryEmail"])
const MAX_RECIPIENTS = 10

// Per-field bounds for the church-info keys, shared by upsertSetting (single-key
// generic writes) and updateChurchInfo (the dedicated form) — upsertSetting
// previously only ran the allowlist + email-format checks, so it could write a
// blank churchName or an arbitrarily long churchAddress/churchABN that the
// dedicated form's ChurchInfoSchema would have rejected.
const CHURCH_INFO_FIELD_SCHEMAS = {
  churchName: z.string().trim().min(1, "Church name is required").max(200),
  churchAddress: z.string().max(500),
  churchABN: z.string().max(20),
} as const

// Validate + normalise a comma-separated recipient list to "a@x.com, b@y.com".
// Returns null when any address is invalid or the count is out of range.
function normaliseRecipientList(value: string): string | null {
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0 || parts.length > MAX_RECIPIENTS) return null
  if (parts.some((p) => !z.string().email().max(255).safeParse(p).success)) return null
  return parts.join(", ")
}

export async function upsertSetting(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const key = ((formData.get("key") as string) ?? "").trim()
  let value = ((formData.get("value") as string) ?? "").trim()

  if (!key) return { error: "Missing key" }
  if (!ALLOWED_KEYS.has(key)) return { error: "Invalid setting key" }
  // Letter keys are bounded + cache-invalidated only by updateLetterSettings;
  // the generic path would bypass both.
  if (LETTER_KEY_SET.has(key)) return { error: "Invalid setting key" }
  if (key === "SESSION_IDLE_TIMEOUT_MINUTES" && !IDLE_TIMEOUT_OPTIONS.has(value)) {
    return { error: "Invalid timeout value" }
  }
  // Email-valued keys must hold a real address (blank clears) — a bad value
  // causes silent sendEmail delivery failures later.
  if (EMAIL_KEYS.has(key) && value !== "" && !z.string().email().max(255).safeParse(value).success) {
    return { error: "Invalid email address" }
  }
  // Multi-recipient keys hold a comma-separated list — validate each address and
  // store a normalised "a@x.com, b@y.com" string that nodemailer's `to` accepts.
  if (MULTI_EMAIL_KEYS.has(key) && value !== "") {
    const normalised = normaliseRecipientList(value)
    if (normalised === null) return { error: "Invalid email address" }
    value = normalised
  }
  // Numeric keys (card-fee rate): reject non-numeric / out-of-bounds so checkout
  // never grosses up against a garbage rate.
  const bound = NUMERIC_KEY_BOUNDS[key]
  if (bound) {
    const n = Number(value)
    if (value === "" || !Number.isFinite(n) || n < bound.min || n > bound.max) {
      return { error: "Invalid value" }
    }
  }
  // Church-info keys carry the same min/max bounds here as the dedicated
  // updateChurchInfo form — this generic action must not be a bypass.
  const churchInfoField = CHURCH_INFO_FIELD_SCHEMAS[key as keyof typeof CHURCH_INFO_FIELD_SCHEMAS]
  if (churchInfoField) {
    const parsed = churchInfoField.safeParse(value)
    if (!parsed.success) return { error: parsed.error.issues[0].message }
    value = parsed.data
  }

  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })

  const userId = actorId(session)
  // Log the key only — raw values can hold PII (emails) or 5000-char HTML.
  await logAudit(userId, "SETTING_UPDATED", "AppSetting", undefined, { key })

  // Bust the cached card-fee reader so checkout/registration pick up the new
  // rate immediately (mirrors church-settings above).
  if (CARD_FEE_KEYS.has(key)) revalidateTag("card-fee", "max")
  revalidatePath("/settings")
  return { success: "Settings saved" }
}

export async function getIdleTimeoutMinutes(): Promise<number> {
  // Every "use server" export is client-callable; gate it. Called from
  // the authenticated dashboard layout, so a no-session caller just gets the
  // default rather than reading the configured value.
  const session = await auth()
  if (!session?.user) return 60
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: "SESSION_IDLE_TIMEOUT_MINUTES" } })
    if (!setting || !IDLE_TIMEOUT_OPTIONS.has(setting.value)) return 60
    return parseInt(setting.value, 10)
  } catch {
    return 60
  }
}

const ChurchInfoSchema = z.object({
  ...CHURCH_INFO_FIELD_SCHEMAS,
  // Optional: blank clears it (getChurchSettings falls back to env), otherwise must be a valid email.
  churchEmail: z.union([z.literal(""), z.string().email().max(255)]).optional(),
  // Optional: blank clears it (getChurchSettings falls back to env / hides the
  // link), otherwise must be a valid URL. Drives the membership + family-update
  // "visit our website" / opt-out links.
  churchWebsite: z.union([z.literal(""), z.string().url("Enter a valid website URL (including https://)").max(500)]).optional(),
})

export async function updateChurchInfo(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = ChurchInfoSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { churchName, churchAddress, churchABN, churchEmail, churchWebsite } = parsed.data

  const entries: { key: string; value: string }[] = [
    { key: "churchName", value: churchName },
    { key: "churchAddress", value: churchAddress },
    { key: "churchABN", value: churchABN },
  ]
  if (churchEmail !== undefined) entries.push({ key: "churchEmail", value: churchEmail })
  if (churchWebsite !== undefined) entries.push({ key: "churchWebsite", value: churchWebsite })

  // Enforce the allowlist as the single source of truth — no settings action writes a key outside it.
  for (const { key } of entries) {
    if (!ALLOWED_KEYS.has(key)) return { error: "Invalid setting key" }
  }

  await Promise.all(
    entries.map((e) =>
      prisma.appSetting.upsert({ where: { key: e.key }, create: { key: e.key, value: e.value }, update: { value: e.value } })
    )
  )

  const userId = actorId(session)
  await logAudit(userId, "SETTING_UPDATED", "AppSetting", undefined, { keys: entries.map((e) => e.key) })

  // Bust the cached getChurchSettings DB read so receipts pick up the change immediately.
  // Next 16 requires the profile arg; "max" = stale-while-revalidate.
  revalidateTag("church-settings", "max")
  revalidatePath("/settings")
  return { success: "Church information saved" }
}

export async function getBirthdayTemplate(): Promise<BirthdayTemplate> {
  // Every "use server" export is client-callable; gate it. Called from
  // the settings page and birthday sends (both authenticated); a no-session
  // caller just gets the default template, never the configured one.
  const session = await auth()
  if (!session?.user) return DEFAULT_BIRTHDAY_TEMPLATE
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ["birthdayEmailSubject", "birthdayEmailBody"] } },
    })
    const get = (key: string, fallback: string) => rows.find((r) => r.key === key)?.value || fallback
    return {
      subject: get("birthdayEmailSubject", DEFAULT_BIRTHDAY_TEMPLATE.subject),
      body: get("birthdayEmailBody", DEFAULT_BIRTHDAY_TEMPLATE.body),
    }
  } catch {
    return DEFAULT_BIRTHDAY_TEMPLATE
  }
}

const BirthdayTemplateSchema = z.object({
  birthdayEmailSubject: z.string().min(1, "Subject required").max(200),
  birthdayEmailBody: z.string().min(1, "Body required").max(5000),
})

export async function updateBirthdayTemplate(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = BirthdayTemplateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const entries = [
    { key: "birthdayEmailSubject", value: parsed.data.birthdayEmailSubject },
    { key: "birthdayEmailBody", value: parsed.data.birthdayEmailBody },
  ]
  for (const { key } of entries) {
    if (!ALLOWED_KEYS.has(key)) return { error: "Invalid setting key" }
  }

  await Promise.all(
    entries.map((e) =>
      prisma.appSetting.upsert({ where: { key: e.key }, create: { key: e.key, value: e.value }, update: { value: e.value } }),
    ),
  )

  const userId = actorId(session)
  await logAudit(userId, "SETTING_UPDATED", "AppSetting", undefined, { keys: entries.map((e) => e.key) })

  revalidatePath("/settings")
  return { success: "Birthday email template saved" }
}

// Sends the CURRENT (possibly unsaved) draft to the signed-in admin, rendered
// with sample data — mirrors emailTemplates.ts::sendTestEmail. Never touches
// members or their consent.
export async function sendTestBirthdayEmail(draft: BirthdayTemplate): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = BirthdayTemplateSchema.safeParse({ birthdayEmailSubject: draft.subject, birthdayEmailBody: draft.body })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const to = session!.user!.email
  if (!to) return { error: "Your account has no email address" }

  const { name: churchName } = await getChurchSettings()
  const { subject, html, text } = renderBirthdayEmail(
    { subject: parsed.data.birthdayEmailSubject, body: parsed.data.birthdayEmailBody },
    { firstName: "Sample Member", ...pronouns(null), churchName },
  )
  try {
    await sendEmail(to, `[TEST] ${subject}`, html, text)
  } catch {
    return { error: "Failed to send test email — check email configuration" }
  }

  await logAudit(actorId(session), "BIRTHDAY_EMAIL_TEST_SENT", "AppSetting", undefined)
  return { success: `Test birthday email sent to ${to}` }
}

export async function getAnniversaryTemplate(): Promise<AnniversaryTemplate> {
  // Every "use server" export is client-callable; gate it. Called from
  // the settings page and anniversary sends (both authenticated); a no-session
  // caller just gets the default template, never the configured one.
  const session = await auth()
  if (!session?.user) return DEFAULT_ANNIVERSARY_TEMPLATE
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ["anniversaryEmailSubject", "anniversaryEmailBody"] } },
    })
    const get = (key: string, fallback: string) => rows.find((r) => r.key === key)?.value || fallback
    return {
      subject: get("anniversaryEmailSubject", DEFAULT_ANNIVERSARY_TEMPLATE.subject),
      body: get("anniversaryEmailBody", DEFAULT_ANNIVERSARY_TEMPLATE.body),
    }
  } catch {
    return DEFAULT_ANNIVERSARY_TEMPLATE
  }
}

const AnniversaryTemplateSchema = z.object({
  anniversaryEmailSubject: z.string().min(1, "Subject required").max(200),
  anniversaryEmailBody: z.string().min(1, "Body required").max(5000),
})

export async function updateAnniversaryTemplate(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = AnniversaryTemplateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const entries = [
    { key: "anniversaryEmailSubject", value: parsed.data.anniversaryEmailSubject },
    { key: "anniversaryEmailBody", value: parsed.data.anniversaryEmailBody },
  ]
  for (const { key } of entries) {
    if (!ALLOWED_KEYS.has(key)) return { error: "Invalid setting key" }
  }

  await Promise.all(
    entries.map((e) =>
      prisma.appSetting.upsert({ where: { key: e.key }, create: { key: e.key, value: e.value }, update: { value: e.value } }),
    ),
  )

  const userId = actorId(session)
  await logAudit(userId, "SETTING_UPDATED", "AppSetting", undefined, { keys: entries.map((e) => e.key) })

  revalidatePath("/settings")
  return { success: "Anniversary email template saved" }
}

// Sends the CURRENT (possibly unsaved) draft to the signed-in admin, rendered
// with sample data — mirror of sendTestBirthdayEmail.
export async function sendTestAnniversaryEmail(draft: AnniversaryTemplate): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = AnniversaryTemplateSchema.safeParse({ anniversaryEmailSubject: draft.subject, anniversaryEmailBody: draft.body })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const to = session!.user!.email
  if (!to) return { error: "Your account has no email address" }

  const { name: churchName } = await getChurchSettings()
  const { subject, html, text } = renderAnniversaryEmail(
    { subject: parsed.data.anniversaryEmailSubject, body: parsed.data.anniversaryEmailBody },
    { names: "Alex & Sam Sample", years: "25", churchName },
  )
  try {
    await sendEmail(to, `[TEST] ${subject}`, html, text)
  } catch {
    return { error: "Failed to send test email — check email configuration" }
  }

  await logAudit(actorId(session), "ANNIVERSARY_EMAIL_TEST_SENT", "AppSetting", undefined)
  return { success: `Test anniversary email sent to ${to}` }
}

export async function getAutoEmailFlags(): Promise<AutoEmailFlags> {
  // Every "use server" export is client-callable; gate it. The cron sweep
  // reads the flags via the auth-free readAutoEmailFlags directly — this gated
  // wrapper is for the settings page. A no-session caller reads both as off.
  const session = await auth()
  if (!session?.user) return { birthday: false, anniversary: false }
  try {
    return await readAutoEmailFlags()
  } catch {
    return { birthday: false, anniversary: false }
  }
}

// Two independent auto-send toggles. Absent checkbox ⇒ off (HTML omits unchecked
// boxes), so read each key explicitly rather than trusting presence.
const AutoEmailSchema = z.object({
  autoBirthdayEmail: z.string().optional().transform((v) => v === "on" || v === "true"),
  autoAnniversaryEmail: z.string().optional().transform((v) => v === "on" || v === "true"),
})

export async function updateAutoEmailFlags(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = AutoEmailSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const entries = [
    { key: "autoBirthdayEmail", value: parsed.data.autoBirthdayEmail ? "true" : "false" },
    { key: "autoAnniversaryEmail", value: parsed.data.autoAnniversaryEmail ? "true" : "false" },
  ]
  for (const { key } of entries) {
    if (!ALLOWED_KEYS.has(key)) return { error: "Invalid setting key" }
  }

  await Promise.all(
    entries.map((e) =>
      prisma.appSetting.upsert({ where: { key: e.key }, create: { key: e.key, value: e.value }, update: { value: e.value } }),
    ),
  )

  await logAudit(actorId(session), "SETTING_UPDATED", "AppSetting", undefined, { keys: entries.map((e) => e.key) })

  revalidatePath("/settings")
  return { success: "Automated email settings saved" }
}

// Empty string clears the setting (auto-open then skips + banners). Otherwise a
// positive integer Person id; existence is verified before write.
const PettyCashCustodianSchema = z.object({
  custodianId: z
    .string()
    .refine((v) => v === "" || /^\d+$/.test(v), "Invalid custodian")
    .transform((v) => (v === "" ? ("" as const) : parseInt(v, 10))),
})

export async function updatePettyCashCustodian(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = PettyCashCustodianSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const value = parsed.data.custodianId
  if (value !== "") {
    // An archived person must not be assignable as custodian — mirrors
    // the createSession/updateSessionCustodian guard in pettyCashSession.ts.
    const person = await prisma.person.findFirst({ where: { id: value, archivedAt: null }, select: { id: true } })
    if (!person) return { error: "Selected person not found" }
  }

  await prisma.appSetting.upsert({
    where: { key: "pettyCashDefaultCustodianId" },
    create: { key: "pettyCashDefaultCustodianId", value: value === "" ? "" : String(value) },
    update: { value: value === "" ? "" : String(value) },
  })

  await logAudit(actorId(session), "SETTING_UPDATED", "AppSetting", undefined, { key: "pettyCashDefaultCustodianId" })

  revalidatePath("/accounting/settings")
  revalidatePath("/accounting/petty-cash")
  return { success: "Default custodian saved" }
}

// Reader for the petty-cash page + ensureWeeklySession. Returns the configured
// Person id, or null when unset/blank/invalid. Gated like the other readers.
export async function getPettyCashDefaultCustodianId(): Promise<number | null> {
  const session = await auth()
  if (!session?.user) return null
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: "pettyCashDefaultCustodianId" } })
    if (!row || !/^\d+$/.test(row.value)) return null
    const id = parseInt(row.value, 10)
    return id > 0 ? id : null
  } catch {
    return null
  }
}

const LetterSettingsSchema = z.object({
  bankGeneralBank: z.string().max(100),
  bankGeneralBsb: z.string().max(20),
  bankGeneralAccount: z.string().max(30),
  bankGeneralAccountName: z.string().max(120),
  bankBuildingBank: z.string().max(100),
  bankBuildingBsb: z.string().max(20),
  bankBuildingAccount: z.string().max(30),
  bankBuildingAccountName: z.string().max(120),
  letterSignerName: z.string().max(120),
  letterSignerTitle: z.string().max(120),
  letterIntro: z.string().max(4000),
  letterContributions: z.string().max(4000),
  letterClosing: z.string().max(4000),
  bankGeneralFundLabel: z.string().max(120),
  bankBuildingFundLabel: z.string().max(120),
})

export async function updateLetterSettings(
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = LetterSettingsSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const entries = Object.entries(parsed.data).map(([key, value]) => ({ key, value: value.trim() }))
  for (const { key } of entries) {
    if (!ALLOWED_KEYS.has(key)) return { error: "Invalid setting key" }
  }

  await Promise.all(
    entries.map((e) =>
      prisma.appSetting.upsert({ where: { key: e.key }, create: { key: e.key, value: e.value }, update: { value: e.value } })
    )
  )

  const userId = actorId(session)
  await logAudit(userId, "SETTING_UPDATED", "AppSetting", undefined, { keys: entries.map((e) => e.key) })

  // Immediate expiry — the next welcome-letter draft must use the copy just saved.
  updateTag("letter-settings")
  revalidatePath("/settings")
  return { success: "Welcome letter settings saved" }
}

const MembershipSettingsSchema = z.object({
  membershipParishFields: z.literal("on").optional(),
  membershipMinDues: z
    .string()
    .trim()
    .max(20)
    .refine(
      (v) => v === "" || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100_000),
      "Minimum dues must be a number between 0 and 100000 (max 2 decimals)"
    ),
  membershipHomeAddressLabel: z.string().trim().max(80, "Field labels must be 80 characters or fewer"),
  membershipArrivalDateLabel: z.string().trim().max(80, "Field labels must be 80 characters or fewer"),
})

// Membership toggles (OSS Phase 3 item 5). Not in ALLOWED_KEYS on purpose —
// the generic upsertSetting path would otherwise write unvalidated values.
export async function updateMembershipSettings(
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = MembershipSettingsSchema.safeParse({
    membershipParishFields: formData.get("membershipParishFields") ?? undefined,
    membershipMinDues: formData.get("membershipMinDues") ?? "",
    membershipHomeAddressLabel: formData.get("membershipHomeAddressLabel") ?? "",
    membershipArrivalDateLabel: formData.get("membershipArrivalDateLabel") ?? "",
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const entries = [
    { key: "membershipParishFields", value: parsed.data.membershipParishFields ? "true" : "false" },
    { key: "membershipMinDues", value: parsed.data.membershipMinDues },
    { key: "membershipHomeAddressLabel", value: parsed.data.membershipHomeAddressLabel },
    { key: "membershipArrivalDateLabel", value: parsed.data.membershipArrivalDateLabel },
  ]
  await prisma.$transaction(
    entries.map((e) => prisma.appSetting.upsert({ where: { key: e.key }, create: e, update: { value: e.value } }))
  )

  await logAudit(actorId(session), "SETTING_UPDATED", "AppSetting", undefined, { keys: entries.map((e) => e.key) })
  // updateTag (not SWR revalidateTag) — the submit action enforces minDues, so a
  // raised floor must apply to the very next application, not after a refresh.
  updateTag("membership-settings")
  revalidatePath("/settings")
  revalidatePath("/membershipform")
  return { success: "Membership settings saved" }
}
