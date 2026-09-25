import { PrismaClient } from "../src/lib/generated/prisma/client"
import { UserRole } from "../src/lib/generated/prisma/enums"
import { PrismaPg } from "@prisma/adapter-pg"
import bcrypt from "bcryptjs"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error("DATABASE_URL not set")

const adapter = new PrismaPg({ connectionString: DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  // No hardcoded fallbacks: the old hardcoded admin email / admin123 defaults
  // are publicly known seed creds, so running this against prod without
  // env vars would mint a known-credential ADMIN. Require both explicitly.
  const email = process.env.USER_EMAIL
  const password = process.env.USER_PASSWORD
  if (!email || !password) {
    throw new Error("USER_EMAIL and USER_PASSWORD must be set")
  }
  // Cast via the UserRole enum so every role (incl. AUDITOR) is accepted — the
  // old literal union silently dropped AUDITOR, the one role with no seeded user.
  const role = (process.env.USER_ROLE as UserRole) || UserRole.ADMIN

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log(`User ${email} already exists (id=${existing.id})`)
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: { email, passwordHash, role, name: email.split("@")[0] },
  })
  console.log(`Created user: ${user.email} (id=${user.id}, role=${user.role})`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
