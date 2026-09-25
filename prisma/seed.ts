import "dotenv/config"
import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { hash } from "bcryptjs"
import { encrypt } from "../src/lib/cryptoCore"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Demo users below have passwords published in this public source. Never let
  // them land on a real deployment — adopters bootstrap with
  // scripts/create-admin-user.ts instead (docs/self-hosting.md).
  // Fail closed on an explicit opt-in: neither NODE_ENV (unset in the source
  // checkout used for migrations) nor a loopback host (same-host Postgres, SSH
  // tunnel) proves the target is a throwaway DB.
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error(
      "Refusing to seed demo users (published passwords) without ALLOW_DEMO_SEED=true. " +
        "Set it only for a local dev/test DB; real installs use scripts/create-admin-user.ts.",
    )
  }

  console.log("Seeding database…")

  async function seedStaff(email: string, name: string, password: string, role: "ADMIN" | "PASTOR" | "VIEWER") {
    return prisma.user.upsert({
      where: { email },
      update: {},
      create: { name, email, passwordHash: await hash(password, 12), role },
    })
  }

  const admin = await seedStaff("admin@example.com", "Admin User", "admin123", "ADMIN")
  const pastor = await seedStaff("pastor@example.com", "Pastor Sample", "pastor123", "PASTOR")
  const viewer = await seedStaff("secretary@example.com", "Church Secretary", "viewer123", "VIEWER")

  const demoFamily = await prisma.family.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: "Sample",
      address: encrypt("1 Example Street"),
      suburb: encrypt("Sampleton"),
      state: "NSW",
      postcode: "2000",
      status: "ACTIVE",
      joinedDate: new Date("2018-01-01"),
    },
  })

  await prisma.person.upsert({
    where: { id: 1 },
    update: {},
    create: {
      familyId: demoFamily.id,
      firstName: "John",
      lastName: "Sample",
      role: "HEAD",
      classification: "MEMBER",
      gender: "MALE",
      dateOfBirth: encrypt("1980-01-01"),
      email: "john@example.com",
      mobile: encrypt("0400 000 001"),
      membershipDate: new Date("2018-01-01"),
    },
  })

  await prisma.person.upsert({
    where: { id: 2 },
    update: {},
    create: {
      familyId: demoFamily.id,
      firstName: "Jane",
      lastName: "Sample",
      role: "SPOUSE",
      classification: "MEMBER",
      gender: "FEMALE",
      dateOfBirth: encrypt("1982-01-01"),
      email: "jane@example.com",
      mobile: encrypt("0400 000 002"),
      membershipDate: new Date("2018-01-01"),
    },
  })

  // Delete old default accounts (skip if transactions are linked)
  try {
    await prisma.account.deleteMany({
      where: {
        code: {
          in: ["4001","4002","4003","4004","4005","5001","5002","5003","5004","5005","5006","5007","5008"],
        },
      },
    })
  } catch {
    // FK violation means transactions reference these accounts — leave them in place
  }

  // Seed the default General fund
  await prisma.fund.upsert({
    where: { name: "General" },
    update: {},
    create: { name: "General", sortOrder: 0 },
  })

  // Upsert account groups
  const groupDefs = [
    { name: "Regular Income",      type: "INCOME"  as const, sortOrder: 1 },
    { name: "Special Events",      type: "INCOME"  as const, sortOrder: 2 },
    { name: "Charity & Donations", type: "INCOME"  as const, sortOrder: 3 },
    { name: "Sunday School",       type: "INCOME"  as const, sortOrder: 4 },
    { name: "Special Events",      type: "EXPENSE" as const, sortOrder: 1 },
    { name: "Church Operations",   type: "EXPENSE" as const, sortOrder: 2 },
    { name: "Ministry & Outreach", type: "EXPENSE" as const, sortOrder: 3 },
    { name: "Sunday School",       type: "EXPENSE" as const, sortOrder: 4 },
    { name: "Other",               type: "EXPENSE" as const, sortOrder: 5 },
  ]

  const groupIdMap: Record<string, number> = {}
  for (const g of groupDefs) {
    const group = await prisma.accountGroup.upsert({
      where: { name_type: { name: g.name, type: g.type } },
      update: { sortOrder: g.sortOrder },
      create: g,
    })
    groupIdMap[`${g.name}:${g.type}`] = group.id
  }

  const G = (name: string, type: "INCOME" | "EXPENSE") => groupIdMap[`${name}:${type}`]

  const newAccounts = [
    // Regular Income
    { code: "4001", name: "Church Subscription Fees",          type: "INCOME" as const, groupId: G("Regular Income", "INCOME") },
    { code: "4002", name: "Sunday Offertory",                  type: "INCOME" as const, groupId: G("Regular Income", "INCOME") },
    { code: "4003", name: "Birthday Offertory",                type: "INCOME" as const, groupId: G("Regular Income", "INCOME") },
    { code: "4004", name: "Wedding Anniversary Offertory",     type: "INCOME" as const, groupId: G("Regular Income", "INCOME") },
    { code: "4005", name: "Thanksgiving / Special Prayer Offertory", type: "INCOME" as const, groupId: G("Regular Income", "INCOME") },
    { code: "4006", name: "Tithe",                             type: "INCOME" as const, groupId: G("Regular Income", "INCOME") },
    // Special Events — Income
    { code: "4007", name: "Annual Festival 2025",              type: "INCOME" as const, groupId: G("Special Events", "INCOME") },
    { code: "4008", name: "Parish Day",                        type: "INCOME" as const, groupId: G("Special Events", "INCOME") },
    { code: "4009", name: "Harvest Festival",                  type: "INCOME" as const, groupId: G("Special Events", "INCOME") },
    { code: "4010", name: "Door to Door Carol",                type: "INCOME" as const, groupId: G("Special Events", "INCOME") },
    { code: "4011", name: "Family Conference",                 type: "INCOME" as const, groupId: G("Special Events", "INCOME") },
    { code: "4012", name: "Family Picnic",                     type: "INCOME" as const, groupId: G("Special Events", "INCOME") },
    // Charity & Donations
    { code: "4013", name: "Charity",                           type: "INCOME" as const, groupId: G("Charity & Donations", "INCOME") },
    { code: "4014", name: "Donations",                         type: "INCOME" as const, groupId: G("Charity & Donations", "INCOME") },
    // Sunday School — Income
    { code: "4015", name: "Sunday School Reg Fees",            type: "INCOME" as const, groupId: G("Sunday School", "INCOME") },
    { code: "4016", name: "Sunday School Dedication Offertory",type: "INCOME" as const, groupId: G("Sunday School", "INCOME") },
    { code: "4017", name: "Sunday School Offertory",           type: "INCOME" as const, groupId: G("Sunday School", "INCOME") },
    { code: "4018", name: "VBS 2025",                          type: "INCOME" as const, groupId: G("Sunday School", "INCOME") },
    // Special Events — Expense
    { code: "5001", name: "Annual Festival 2025",              type: "EXPENSE" as const, groupId: G("Special Events", "EXPENSE") },
    { code: "5002", name: "Parish Day",                        type: "EXPENSE" as const, groupId: G("Special Events", "EXPENSE") },
    { code: "5003", name: "Harvest Festival",                  type: "EXPENSE" as const, groupId: G("Special Events", "EXPENSE") },
    { code: "5004", name: "Passion Week",                      type: "EXPENSE" as const, groupId: G("Special Events", "EXPENSE") },
    { code: "5005", name: "Parish Convention",                 type: "EXPENSE" as const, groupId: G("Special Events", "EXPENSE") },
    { code: "5006", name: "Carol Service",                     type: "EXPENSE" as const, groupId: G("Special Events", "EXPENSE") },
    { code: "5007", name: "Door to Door Carol",                type: "EXPENSE" as const, groupId: G("Special Events", "EXPENSE") },
    { code: "5008", name: "Family Conference",                 type: "EXPENSE" as const, groupId: G("Special Events", "EXPENSE") },
    { code: "5009", name: "Family Picnic",                     type: "EXPENSE" as const, groupId: G("Special Events", "EXPENSE") },
    // Church Operations
    { code: "5010", name: "Vicar TA",                          type: "EXPENSE" as const, groupId: G("Church Operations", "EXPENSE") },
    { code: "5011", name: "Church Rent / Maintenance",         type: "EXPENSE" as const, groupId: G("Church Operations", "EXPENSE") },
    { code: "5012", name: "New Anglican Church – Cleaning, Fans, Heaters", type: "EXPENSE" as const, groupId: G("Church Operations", "EXPENSE") },
    { code: "5013", name: "Sound Systems – New Anglican Church",type: "EXPENSE" as const, groupId: G("Church Operations", "EXPENSE") },
    { code: "5014", name: "IT – Website, MYOB, Domain",        type: "EXPENSE" as const, groupId: G("Church Operations", "EXPENSE") },
    { code: "5015", name: "Operational Expenses",              type: "EXPENSE" as const, groupId: G("Church Operations", "EXPENSE") },
    { code: "5016", name: "Public Liability Insurance",        type: "EXPENSE" as const, groupId: G("Church Operations", "EXPENSE") },
    // Ministry & Outreach
    { code: "5017", name: "Charity",                           type: "EXPENSE" as const, groupId: G("Ministry & Outreach", "EXPENSE") },
    { code: "5018", name: "Women's Fellowship",                type: "EXPENSE" as const, groupId: G("Ministry & Outreach", "EXPENSE") },
    { code: "5019", name: "Youth Grant",                       type: "EXPENSE" as const, groupId: G("Ministry & Outreach", "EXPENSE") },
    { code: "5020", name: "Sydney Church Contribution",        type: "EXPENSE" as const, groupId: G("Ministry & Outreach", "EXPENSE") },
    // Sunday School — Expense
    { code: "5021", name: "Sunday School Grant",               type: "EXPENSE" as const, groupId: G("Sunday School", "EXPENSE") },
    { code: "5022", name: "Annual Sunday School Competitions", type: "EXPENSE" as const, groupId: G("Sunday School", "EXPENSE") },
    { code: "5023", name: "VBS 2025",                          type: "EXPENSE" as const, groupId: G("Sunday School", "EXPENSE") },
    { code: "5024", name: "VBS 2025 Church Grant",             type: "EXPENSE" as const, groupId: G("Sunday School", "EXPENSE") },
    { code: "5025", name: "Sunday School Picnic",              type: "EXPENSE" as const, groupId: G("Sunday School", "EXPENSE") },
    // Other
    { code: "5026", name: "Miscellaneous",                     type: "EXPENSE" as const, groupId: G("Other", "EXPENSE") },
  ]

  for (const acc of newAccounts) {
    await prisma.account.upsert({
      where: { code: acc.code },
      update: { name: acc.name, groupId: acc.groupId },
      create: { code: acc.code, name: acc.name, type: acc.type, isActive: true, groupId: acc.groupId },
    })
  }

  // Internal-transfer placeholder used by petty-cash bank-import rows.
  // Pre-seeded here so it's an explicit part of the chart of accounts rather
  // than being silently conjured by the first bank import. Inactive + groupless
  // so it never shows in pickers or report groups. update:{} keeps it idempotent
  // without clobbering any manual edits.
  await prisma.account.upsert({
    where: { code: "XFER" },
    update: {},
    create: { code: "XFER", name: "Internal Transfer", type: "EXPENSE", isActive: false },
  })

  // Card surcharge default rate (blended domestic Stripe fee). update:{} so
  // re-seeding never clobbers an admin-changed value.
  await prisma.appSetting.upsert({ where: { key: "cardFeePercent" }, update: {}, create: { key: "cardFeePercent", value: "1.7" } })
  await prisma.appSetting.upsert({ where: { key: "cardFeeFixed" }, update: {}, create: { key: "cardFeeFixed", value: "0.30" } })

  // Payment accounts — only seed a generic starter set on an EMPTY table.
  // Prod is already populated by the backfill migration, so this is a no-op there.
  if ((await prisma.paymentAccount.count()) === 0) {
    await prisma.paymentAccount.create({ data: { name: "Main Bank Account", kind: "BANK", isDefault: true } })
    await prisma.paymentAccount.create({ data: { name: "Petty Cash", kind: "CASH" } })
    console.log("Payment accounts: seeded generic starter set (Main Bank Account, Petty Cash)")
  }

  console.log("Seed complete.")
  console.log(`Users: ${admin.email}, ${pastor.email}, ${viewer.email}`)
  console.log(`Family: ${demoFamily.name} (id: ${demoFamily.id})`)
  console.log(`Accounts: ${newAccounts.length} accounts seeded across ${groupDefs.length} groups`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
