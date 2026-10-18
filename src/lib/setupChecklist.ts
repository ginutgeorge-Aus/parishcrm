import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { logger } from "@/lib/logger"
import { getChurchSettingsFresh, missingChurchIdentity } from "@/lib/churchSettings"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { getEnabledFeatures } from "@/lib/featureFlags"

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
 * Loads the first-run setup checklist for the dashboard, or null when it
 * should not show: the viewer isn't an ADMIN (every step links to an
 * ADMIN-only page), every step is already done, or the DB read failed (a
 * setup hint must never break the dashboard).
 *
 * Each step is one cheap lookup (the church settings rows, `findFirst`
 * selecting only the id elsewhere) — no counts over big tables and nothing
 * encrypted is read. "Done" means usable: church identity complete as receipts
 * require (name, address, ABN), the LOGO slot uploaded (the one the sidebar and
 * login render), an active income/expense category (the auto-created inactive
 * XFER account doesn't count) and an active BANK account (the auto-created
 * Petty Cash CASH account doesn't count).
 */
export async function getSetupChecklist(role: UserRole | undefined): Promise<SetupStep[] | null> {
  if (!isAdmin(role)) return null

  let rows
  try {
    rows = await Promise.all([
      getChurchSettingsFresh(),
      prisma.brandingAsset.findFirst({ where: { slot: "LOGO" }, select: { slot: true } }),
      prisma.person.findFirst({ where: { archivedAt: null }, select: { id: true } }),
      prisma.account.findFirst({
        where: { isActive: true, type: { in: ["INCOME", "EXPENSE"] }, code: { not: "XFER" } },
        select: { id: true },
      }),
      prisma.paymentAccount.findFirst({
        where: { isActive: true, kind: "BANK" },
        select: { id: true },
      }),
      getEnabledFeatures(),
    ])
  } catch (err) {
    // Name + Prisma error code only: the message can echo query values (PII).
    const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : undefined
    logger.error("[setupChecklist] DB read failed — hiding the checklist", {
      error: err instanceof Error ? err.name : "UnknownError",
      ...(code && { code }),
    })
    return null
  }
  const [church, branding, person, account, paymentAccount, features] = rows

  const steps: SetupStep[] = [
    {
      id: "church",
      title: "Add your church details",
      description: "Your church's name, address and ABN, used on receipts, emails and letters.",
      href: "/settings#general",
      done: missingChurchIdentity(church).length === 0,
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

  // The accounting steps link into /accounting, which 404s while Accounting is off.
  const shown = features.has("accounting")
    ? steps
    : steps.filter((s) => s.id !== "categories" && s.id !== "paymentAccounts")
  return shown.every((s) => s.done) ? null : shown
}
