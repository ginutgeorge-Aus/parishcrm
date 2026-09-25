// Emergency: clear password + OTP lockout on all ADMIN accounts.
// Use if a DAST/scan or brute-force locks out every admin (else lock auto-expires in 15 min).
// Run: DATABASE_URL=<prod> npx tsx scripts/unlock-admins.ts
// Builds its own PrismaClient (not @/lib/prisma, which is `import "server-only"`
// and throws when run directly via tsx — the outage tool must not depend on it).
import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error("DATABASE_URL not set")

const adapter = new PrismaPg({ connectionString: DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const res = await prisma.user.updateMany({
    where: { role: "ADMIN" },
    data: { failedLoginAttempts: 0, lockedUntil: null, failedOtpAttempts: 0, otpLockedUntil: null },
  })
  console.log(`Cleared lockout on ${res.count} ADMIN account(s).`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
