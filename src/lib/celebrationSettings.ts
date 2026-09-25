/**
 * Auth-free readers for the celebration-email settings (toggles + templates).
 *
 * The `"use server"` readers in `src/lib/actions/settings.ts` gate on a session
 * and fall back to defaults for a no-session caller. The daily cron sweep
 * (`celebrationSweep.ts`) runs with NO session, so calling those would silently
 * read every toggle as OFF and every template as the code default, ignoring the
 * admin's saved edits. This module reads `AppSetting` directly (no next-auth
 * import — like `emailTemplateStore.ts`) so both the sweep and the gated
 * settings action share one source of truth for the keys + per-field fallback.
 */
import { prisma } from "@/lib/prisma"
import { DEFAULT_BIRTHDAY_TEMPLATE, type BirthdayTemplate } from "@/lib/birthdayTemplate"
import { DEFAULT_ANNIVERSARY_TEMPLATE, type AnniversaryTemplate } from "@/lib/anniversaryTemplate"

export const AUTO_EMAIL_KEYS = ["autoBirthdayEmail", "autoAnniversaryEmail"] as const

export type AutoEmailFlags = { birthday: boolean; anniversary: boolean }

/** Both auto-send toggles. Absent / any non-"true" value ⇒ off. */
export async function readAutoEmailFlags(): Promise<AutoEmailFlags> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...AUTO_EMAIL_KEYS] } } })
  const on = (key: string) => rows.find((r) => r.key === key)?.value === "true"
  return { birthday: on("autoBirthdayEmail"), anniversary: on("autoAnniversaryEmail") }
}

/** Birthday template with per-field fallback to the code default when unset/blank. */
export async function readBirthdayTemplate(): Promise<BirthdayTemplate> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["birthdayEmailSubject", "birthdayEmailBody"] } },
  })
  const get = (key: string, fallback: string) => rows.find((r) => r.key === key)?.value || fallback
  return {
    subject: get("birthdayEmailSubject", DEFAULT_BIRTHDAY_TEMPLATE.subject),
    body: get("birthdayEmailBody", DEFAULT_BIRTHDAY_TEMPLATE.body),
  }
}

/** Anniversary template with per-field fallback to the code default when unset/blank. */
export async function readAnniversaryTemplate(): Promise<AnniversaryTemplate> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["anniversaryEmailSubject", "anniversaryEmailBody"] } },
  })
  const get = (key: string, fallback: string) => rows.find((r) => r.key === key)?.value || fallback
  return {
    subject: get("anniversaryEmailSubject", DEFAULT_ANNIVERSARY_TEMPLATE.subject),
    body: get("anniversaryEmailBody", DEFAULT_ANNIVERSARY_TEMPLATE.body),
  }
}
