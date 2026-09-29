import { prisma } from "@/lib/prisma"

// Plain server module (NOT "use server", no `server-only` import — Jest has no
// mapping for it), same pattern as src/lib/churchSettings.ts.
// First-run gate shared by the /setup page and createFirstAdmin. Open only
// while an operator-set SETUP_TOKEN exists AND the DB has zero users, so the
// page self-disables the moment the first account is created.
export async function isSetupOpen(): Promise<boolean> {
  if (!process.env.SETUP_TOKEN) return false
  return (await prisma.user.count()) === 0
}
