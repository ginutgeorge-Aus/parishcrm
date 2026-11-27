// Emergency: clear password + OTP lockout on all ADMIN accounts.
// Use if a DAST/scan or brute-force locks out every admin (else lock auto-expires in 15 min).
// Dry run by default (prints the target host + the admin ids it would unlock). To write:
//   DATABASE_URL=<prod> npx tsx scripts/unlock-admins.ts --apply --yes
// Builds its own PrismaClient (not @/lib/prisma, which is `import "server-only"`
// and throws when run directly via tsx — the outage tool must not depend on it).
import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error("DATABASE_URL not set")

const adapter = new PrismaPg({ connectionString: DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const { apply: APPLY, confirmed: CONFIRMED } = parseScriptArgs()

/**
 * Clears lockout state on ADMIN accounts. Dry run unless `--apply --yes` (AUD-7-10); prints the
 * target host and affected admin ids (never emails) so a wrong DATABASE_URL is obvious.
 * @returns resolves when the dry run or write has finished
 */
async function main() {
  console.log(`Unlock ADMIN accounts — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())
  const where = { role: "ADMIN" as const }
  if (!APPLY) {
    const admins = await prisma.user.findMany({ where, select: { id: true } })
    console.log(`Would clear lockout on ${admins.length} ADMIN account(s) (ids: ${admins.map((a) => a.id).join(", ") || "none"}).`)
    console.log("Dry run complete. Re-run with --apply --yes to write.")
    return
  }
  const res = await prisma.user.updateMany({
    where,
    data: { failedLoginAttempts: 0, lockedUntil: null, failedOtpAttempts: 0, otpLockedUntil: null },
  })
  console.log(`Cleared lockout on ${res.count} ADMIN account(s).`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
