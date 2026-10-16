import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
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

// Once every step has been seen done, this process stops checking — the
// checklist is a first-run aid, so it shouldn't cost five queries on every
// dashboard load for the life of the install. Per-process is fine: the app is
// single-tenant, and a fresh process just re-checks once.
let setupComplete = false

/** Test hook: forget the "setup complete" memo. */
export function resetSetupChecklistCache(): void {
  setupComplete = false
}

/**
 * Loads the first-run setup checklist for the dashboard, or null when it
 * should not show: the viewer isn't an ADMIN (every step links to an
 * ADMIN-only page), or every step is already done.
 *
 * Each step is a single indexed existence check (`findFirst` selecting the
 * key) — no counts over big tables and nothing encrypted is read.
 */
export async function getSetupChecklist(role: UserRole | undefined): Promise<SetupStep[] | null> {
  if (!isAdmin(role) || setupComplete) return null

  const [churchName, branding, person, account, paymentAccount] = await Promise.all([
    prisma.appSetting.findFirst({ where: { key: "churchName", value: { not: "" } }, select: { key: true } }),
    prisma.brandingAsset.findFirst({ select: { slot: true } }),
    prisma.person.findFirst({ where: { archivedAt: null }, select: { id: true } }),
    prisma.account.findFirst({ select: { id: true } }),
    prisma.paymentAccount.findFirst({ select: { id: true } }),
  ])

  const steps: SetupStep[] = [
    {
      id: "church",
      title: "Add your church details",
      description: "Name, address and ABN used on receipts, emails and letters.",
      href: "/settings#general",
      // The CHURCH_NAME env var is the documented fallback, so it counts too.
      done: churchName !== null || Boolean(process.env.CHURCH_NAME?.trim()),
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

  if (steps.every((s) => s.done)) {
    setupComplete = true
    return null
  }
  return steps
}
