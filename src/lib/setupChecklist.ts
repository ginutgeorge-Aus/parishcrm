import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { logger } from "@/lib/logger"
import { DEFAULT_CHURCH_NAME } from "@/lib/settingsConstants"
import type { UserRole } from "@/lib/generated/prisma/enums"

/** One first-run setup step shown on the dashboard checklist. */
export type SetupStep = {
  id: "church" | "branding" | "people" | "categories" | "paymentAccounts"
  title: string
  description: string
  /** Where the step is done. */
  href: string
  done: boolean
}

/**
 * True when a church name/address value is really set: non-blank after
 * trimming, and (for the name) not the shipped "Your Church" placeholder —
 * `.env.example` and a ChurchInfoForm saved with its pre-filled fallback both
 * carry that placeholder, which mustn't tick the step.
 */
function isRealValue(value: string | null | undefined, placeholder?: string): boolean {
  const v = value?.trim() ?? ""
  return v !== "" && v !== placeholder
}

/**
 * Loads the first-run setup checklist for the dashboard, or null when it
 * should not show: the viewer isn't an ADMIN (every step links to an
 * ADMIN-only page), every step is already done, or the DB read failed (a
 * setup hint must never break the dashboard).
 *
 * Each step is one cheap indexed lookup (`findMany` on two AppSetting primary
 * keys, `findFirst` selecting only the key elsewhere) — no counts over big
 * tables and nothing encrypted is read.
 */
export async function getSetupChecklist(role: UserRole | undefined): Promise<SetupStep[] | null> {
  if (!isAdmin(role)) return null

  let rows
  try {
    rows = await Promise.all([
      prisma.appSetting.findMany({
        where: { key: { in: ["churchName", "churchAddress"] } },
        select: { key: true, value: true },
      }),
      prisma.brandingAsset.findFirst({ select: { slot: true } }),
      prisma.person.findFirst({ where: { archivedAt: null }, select: { id: true } }),
      prisma.account.findFirst({ select: { id: true } }),
      prisma.paymentAccount.findFirst({ select: { id: true } }),
    ])
  } catch (err) {
    logger.error("[setupChecklist] DB read failed — hiding the checklist", {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
  const [churchRows, branding, person, account, paymentAccount] = rows

  // A saved setting wins; the env var is the documented fallback (same order
  // as getChurchSettings).
  const setting = (key: string) => churchRows.find((r) => r.key === key)?.value
  const churchName = setting("churchName")?.trim() || process.env.CHURCH_NAME
  const churchAddress = setting("churchAddress")?.trim() || process.env.CHURCH_ADDRESS

  const steps: SetupStep[] = [
    {
      id: "church",
      title: "Add your church details",
      description: "Your church's name and address, used on receipts, emails and letters.",
      href: "/settings#general",
      done: isRealValue(churchName, DEFAULT_CHURCH_NAME) && isRealValue(churchAddress),
    },
    {
      id: "branding",
      title: "Upload your logo",
      description: "Your logo on the login screen and sidebar; a letterhead for receipts.",
      href: "/settings#branding",
      done: branding !== null,
    },
    {
      id: "people",
      title: "Add your people",
      description: "Import your member list from a CSV, or add families by hand.",
      href: "/families",
      done: person !== null,
    },
    {
      id: "categories",
      title: "Set up income and expense categories",
      description: "The chart of accounts every transaction is filed under.",
      href: "/accounting/accounts",
      done: account !== null,
    },
    {
      id: "paymentAccounts",
      title: "Add your bank and cash accounts",
      description: "Where money is held, with opening balances for the dashboard.",
      href: "/accounting/settings",
      done: paymentAccount !== null,
    },
  ]

  return steps.every((s) => s.done) ? null : steps
}
