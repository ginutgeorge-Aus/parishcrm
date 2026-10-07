import { prisma } from "@/lib/prisma"

/** AppSetting key holding an override for the WWCC verification portal URL. */
export const WWCC_VERIFY_URL_KEY = "clearance.wwccVerifyUrl"

/** NSW Office of the Children's Guardian employer portal. */
export const DEFAULT_WWCC_VERIFY_URL = "https://wwccemployer.ocg.nsw.gov.au/Login"

/**
 * URL of the portal where an admin checks a WWCC. Churches outside NSW can
 * override it via the AppSetting row `clearance.wwccVerifyUrl`. Only well-formed
 * https URLs are honoured (the value is rendered as a link, so a `javascript:`
 * or `http:` value must never reach the page) — anything else falls back to the
 * NSW default.
 */
export async function getWwccVerifyUrl(): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key: WWCC_VERIFY_URL_KEY } })
  const value = row?.value?.trim()
  if (!value) return DEFAULT_WWCC_VERIFY_URL
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.toString() : DEFAULT_WWCC_VERIFY_URL
  } catch {
    return DEFAULT_WWCC_VERIFY_URL
  }
}
