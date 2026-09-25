import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"

// One church bank account as rendered on the welcome letter. taxDeductible is
// fixed per-slot (not stored); fundLabel + bank/bsb/account/name are
// admin-editable via AppSetting (fundLabel falls back to a generic default).
export type BankAccount = {
  fundLabel: string
  bank: string
  bsb: string
  account: string
  accountName: string
  taxDeductible: boolean
}

export type LetterSettings = {
  general: BankAccount
  building: BankAccount
  signerName: string
  signerTitle: string
  // Raw stored welcome-letter copy ("" = use the generic default in welcomeLetter.ts).
  introTemplate: string
  contributionsTemplate: string
  closingTemplate: string
}

export const LETTER_SETTING_KEYS = [
  "bankGeneralBank", "bankGeneralBsb", "bankGeneralAccount", "bankGeneralAccountName",
  "bankBuildingBank", "bankBuildingBsb", "bankBuildingAccount", "bankBuildingAccountName",
  "letterSignerName", "letterSignerTitle",
  "letterIntro", "letterContributions", "letterClosing",
  "bankGeneralFundLabel", "bankBuildingFundLabel",
] as const

// Cache the pure DB read (1h) under its own tag; updateLetterSettings busts it.
const getRows = unstable_cache(
  () => prisma.appSetting.findMany({ where: { key: { in: [...LETTER_SETTING_KEYS] } } }),
  ["letter-settings"],
  { tags: ["letter-settings"], revalidate: 3600 }
)

export async function getLetterSettings(): Promise<LetterSettings> {
  const rows = await getRows()
  const g = (key: string) => rows.find((r) => r.key === key)?.value ?? ""
  return {
    general: {
      fundLabel: g("bankGeneralFundLabel").trim() || "General Fund",
      bank: g("bankGeneralBank"),
      bsb: g("bankGeneralBsb"),
      account: g("bankGeneralAccount"),
      accountName: g("bankGeneralAccountName"),
      taxDeductible: false,
    },
    building: {
      fundLabel: g("bankBuildingFundLabel").trim() || "Building Fund",
      bank: g("bankBuildingBank"),
      bsb: g("bankBuildingBsb"),
      account: g("bankBuildingAccount"),
      accountName: g("bankBuildingAccountName"),
      taxDeductible: true,
    },
    signerName: g("letterSignerName"),
    signerTitle: g("letterSignerTitle"),
    introTemplate: g("letterIntro"),
    contributionsTemplate: g("letterContributions"),
    closingTemplate: g("letterClosing"),
  }
}
