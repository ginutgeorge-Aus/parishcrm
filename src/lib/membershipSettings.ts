import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

// Membership behaviour toggles (OSS Phase 3 item 5). Blank/missing = generic
// install: no parish fields, no dues minimum, no overseas-address / arrival-date
// fields (a blank label hides the field). An instance sets these in Settings.
// Updated by updateMembershipSettings, which busts the tag.
export type MembershipSettings = {
  parishFields: boolean
  minDues: number | null
  homeAddressLabel: string
  arrivalDateLabel: string
}

const MEMBERSHIP_SETTING_KEYS = [
  "membershipParishFields",
  "membershipMinDues",
  "membershipHomeAddressLabel",
  "membershipArrivalDateLabel",
] as const

const MAX_MIN_DUES = 100_000

export function parseMembershipSettings(rows: { key: string; value: string }[]): MembershipSettings {
  const g = (key: string) => rows.find((r) => r.key === key)?.value.trim() ?? ""
  const raw = g("membershipMinDues")
  const n = raw === "" ? Number.NaN : Number(raw)
  return {
    parishFields: g("membershipParishFields") === "true",
    minDues: Number.isFinite(n) && n >= 0 && n <= MAX_MIN_DUES ? n : null,
    homeAddressLabel: g("membershipHomeAddressLabel"),
    arrivalDateLabel: g("membershipArrivalDateLabel"),
  }
}

const getRows = unstable_cache(
  () => prisma.appSetting.findMany({ where: { key: { in: [...MEMBERSHIP_SETTING_KEYS] } } }),
  ["membership-settings"],
  { tags: ["membership-settings"], revalidate: 3600 }
)

// Lenient: read by the public membership form — never throws.
export async function getMembershipSettings(): Promise<MembershipSettings> {
  try {
    return parseMembershipSettings(await getRows())
  } catch (err) {
    logger.error("[membershipSettings] DB read failed — using generic defaults", {
      error: err instanceof Error ? err.message : String(err),
    })
    return { parishFields: false, minDues: null, homeAddressLabel: "", arrivalDateLabel: "" }
  }
}
