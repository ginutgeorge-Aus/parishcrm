import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { buildMaintenanceState, MAINTENANCE_KEY } from "../src/lib/maintenance"

// Toggle the site-wide maintenance flag (AppSetting key `maintenance`).
// Used by .github/workflows/deploy.yml (on before migrate, off at job end)
// and as the manual escape hatch if the flag ever sticks:
//   npx tsx scripts/set-maintenance.ts off
// Usage: set-maintenance.ts <on|off> [--eta-minutes N]   (N default 6)

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

function etaMinutes(): number {
  const i = process.argv.indexOf("--eta-minutes")
  if (i !== -1 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1])
    if (Number.isFinite(n) && n > 0) return n
  }
  return 6
}

async function main() {
  const mode = process.argv[2]
  if (mode !== "on" && mode !== "off") {
    console.error("Usage: set-maintenance.ts <on|off> [--eta-minutes N]")
    process.exit(2)
  }
  const state = buildMaintenanceState(mode === "on", etaMinutes(), new Date())
  const value = JSON.stringify(state)
  await prisma.appSetting.upsert({
    where: { key: MAINTENANCE_KEY },
    create: { key: MAINTENANCE_KEY, value },
    update: { value },
  })
  console.log(`maintenance ${mode} → ${value}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
