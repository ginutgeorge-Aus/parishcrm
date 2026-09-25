import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { keyIdOf } from "../src/lib/cryptoCore"
import { dbHost } from "./lib/script-helpers"

// Read-only data-integrity audit. Runs count/groupBy/batched-scan
// queries only — never writes. Reports three classes of problem:
//   1. Encryption leaks   — a field that should be `enc:`-ciphertext at rest
//                           but holds plaintext (missed backfill / bad write path).
//   2. Blind-index gaps   — a row with an email but no emailHash.
//   3. Referential/invariant drift — FK-enforced orphans can't exist, but
//                           logical invariants (isGiving↔familyId, ledger sync,
//                           active-under-archived, nullable-but-assumed) can.
//
// Exit code is non-zero if any problem is found, so it can gate a cron/CI check.
// Migration drift (`prisma migrate diff`) is a separate offline step — see the
// footer note; it needs the prod schema URL this script does not touch.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const BATCH = 500
let problems = 0

function ok(label: string, detail = "") {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`)
}
function bad(label: string, count: number, hint = "") {
  problems += count
  console.log(`  ✗ ${label}: ${count}${hint ? ` — ${hint}` : ""}`)
}

// Scan an encrypted string/Json field in batches, counting rows whose stored
// value is present but NOT `enc:`-prefixed (i.e. plaintext leaked at rest).
// Json columns holding an encrypted string come back as a JS string; a legacy
// un-encrypted Json value comes back as an object/array — both are leaks.
async function scanEncrypted(
  model: string,
  field: string,
  findMany: (skip: number) => Promise<Array<{ id: number | string; v: unknown }>>,
): Promise<void> {
  let skip = 0
  let leaked = 0
  let scanned = 0
  const sample: (number | string)[] = []
  for (;;) {
    const rows = await findMany(skip)
    if (rows.length === 0) break
    for (const row of rows) {
      if (row.v === null || row.v === undefined) continue
      // An empty string is never ciphertext but also never a plaintext leak —
      // it holds no PII. A retention purge scrubs Registration.email to "" (a
      // non-null column), so treating "" as a leak flagged every purged row and
      // wedged the exit code red forever. Skip it like null.
      if (row.v === "") continue
      scanned++
      const isCipher = typeof row.v === "string" && keyIdOf(row.v) !== null
      if (!isCipher) {
        leaked++
        if (sample.length < 5) sample.push(row.id)
      }
    }
    skip += rows.length
    if (rows.length < BATCH) break
  }
  if (leaked === 0) ok(`${model}.${field}`, `${scanned} value(s), all encrypted`)
  else bad(`${model}.${field} PLAINTEXT`, leaked, `ids e.g. ${sample.join(", ")} — run the matching encrypt-* backfill`)
}

async function main() {
  console.log(`Data-integrity audit — READ ONLY`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}\n`)

  // ── 1. Encryption completeness ────────────────────────────────────────────
  console.log("1. Encryption at rest (no plaintext should remain)")
  await scanEncrypted("Person", "email", async (skip) =>
    (await prisma.person.findMany({ where: { email: { not: null } }, orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, email: true } })).map(r => ({ id: r.id, v: r.email })),
  )
  await scanEncrypted("Family", "state", async (skip) =>
    (await prisma.family.findMany({ where: { state: { not: null } }, orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, state: true } })).map(r => ({ id: r.id, v: r.state })),
  )
  await scanEncrypted("Family", "postcode", async (skip) =>
    (await prisma.family.findMany({ where: { postcode: { not: null } }, orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, postcode: true } })).map(r => ({ id: r.id, v: r.postcode })),
  )
  await scanEncrypted("Registration", "email", async (skip) =>
    // Exclude retention-purged rows (email scrubbed to "") — they hold no
    // email to encrypt, so scanning them only produces false leaks.
    (await prisma.registration.findMany({ where: { anonymizedAt: null }, orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, email: true } })).map(r => ({ id: r.id, v: r.email })),
  )
  await scanEncrypted("Registration", "phone", async (skip) =>
    (await prisma.registration.findMany({ where: { phone: { not: null } }, orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, phone: true } })).map(r => ({ id: r.id, v: r.phone })),
  )
  // Json fields: scan all rows and skip nulls in JS — avoids the Prisma
  // JsonNull/DbNull filter distinction, which `equals: null` gets wrong.
  await scanEncrypted("Registration", "customAnswers", async (skip) =>
    (await prisma.registration.findMany({ orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, customAnswers: true } })).map(r => ({ id: r.id, v: r.customAnswers })),
  )
  await scanEncrypted("Attendee", "answers", async (skip) =>
    (await prisma.attendee.findMany({ orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, answers: true } })).map(r => ({ id: r.id, v: r.answers })),
  )
  await scanEncrypted("Waitlist", "email", async (skip) =>
    (await prisma.waitlist.findMany({ orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, email: true } })).map(r => ({ id: r.id, v: r.email })),
  )
  await scanEncrypted("FamilyUpdateInvite", "email", async (skip) =>
    (await prisma.familyUpdateInvite.findMany({ orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, email: true } })).map(r => ({ id: r.id, v: r.email })),
  )
  await scanEncrypted("FamilyUpdateSubmission", "payload", async (skip) =>
    (await prisma.familyUpdateSubmission.findMany({ orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, payload: true } })).map(r => ({ id: r.id, v: r.payload })),
  )
  await scanEncrypted("PettyCashReceipt", "notes", async (skip) =>
    (await prisma.pettyCashReceipt.findMany({ where: { notes: { not: null } }, orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, notes: true } })).map(r => ({ id: r.id, v: r.notes })),
  )
  await scanEncrypted("PettyCashExpense", "payee", async (skip) =>
    (await prisma.pettyCashExpense.findMany({ orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, payee: true } })).map(r => ({ id: r.id, v: r.payee })),
  )
  await scanEncrypted("PettyCashExpense", "description", async (skip) =>
    (await prisma.pettyCashExpense.findMany({ orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, description: true } })).map(r => ({ id: r.id, v: r.description })),
  )
  await scanEncrypted("PettyCashTransfer", "depositedByName", async (skip) =>
    (await prisma.pettyCashTransfer.findMany({ orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, depositedByName: true } })).map(r => ({ id: r.id, v: r.depositedByName })),
  )
  await scanEncrypted("PettyCashTransfer", "notes", async (skip) =>
    (await prisma.pettyCashTransfer.findMany({ where: { notes: { not: null } }, orderBy: { id: "asc" }, skip, take: BATCH, select: { id: true, notes: true } })).map(r => ({ id: r.id, v: r.notes })),
  )

  // ── 2. Blind-index (emailHash) completeness ───────────────────────────────
  console.log("\n2. Blind-index completeness (email present ⇒ emailHash set)")
  const personHashGap = await prisma.person.count({ where: { email: { not: null }, emailHash: null } })
  personHashGap === 0 ? ok("Person.emailHash") : bad("Person missing emailHash", personHashGap, "run backfill-email-hash")
  // Exclude retention-purged rows: the purge intentionally clears emailHash (the
  // email is gone), so counting them as gaps flagged a permanent, unfixable
  // failure — backfill-email-hash can't hash an email that no longer exists.
  const regHashGap = await prisma.registration.count({ where: { emailHash: null, anonymizedAt: null } })
  regHashGap === 0 ? ok("Registration.emailHash") : bad("Registration missing emailHash", regHashGap, "run backfill-email-hash")
  // Waitlist.emailHash is nullable BY DESIGN for pre-existing rows — report as info, not a failure.
  const wlHashGap = await prisma.waitlist.count({ where: { emailHash: null } })
  wlHashGap === 0 ? ok("Waitlist.emailHash") : ok("Waitlist.emailHash", `${wlHashGap} legacy row(s) without hash (nullable by design)`)

  // ── 3. Referential / invariant drift ──────────────────────────────────────
  console.log("\n3. Invariants (FK orphans are DB-enforced; these are logical)")
  // isGiving must equal !!familyId (see data-model rule).
  const givingNoFamily = await prisma.transaction.count({ where: { isGiving: true, familyId: null } })
  const familyNotGiving = await prisma.transaction.count({ where: { isGiving: false, familyId: { not: null } } })
  givingNoFamily === 0 ? ok("Transaction.isGiving ⇒ familyId") : bad("isGiving=true but no familyId", givingNoFamily)
  familyNotGiving === 0 ? ok("Transaction.familyId ⇒ isGiving") : bad("familyId set but isGiving=false", familyNotGiving)

  // Petty-cash entries mirror to the ledger on create — every one should
  // carry a linked Transaction.
  const rcptNoTxn = await prisma.pettyCashReceipt.count({ where: { transaction: { is: null } } })
  const expNoTxn = await prisma.pettyCashExpense.count({ where: { transaction: { is: null } } })
  const xferNoTxn = await prisma.pettyCashTransfer.count({ where: { transaction: { is: null } } })
  rcptNoTxn === 0 ? ok("PettyCashReceipt ledger sync") : bad("PettyCashReceipt without Transaction", rcptNoTxn)
  expNoTxn === 0 ? ok("PettyCashExpense ledger sync") : bad("PettyCashExpense without Transaction", expNoTxn)
  xferNoTxn === 0 ? ok("PettyCashTransfer ledger sync") : bad("PettyCashTransfer without Transaction", xferNoTxn)

  // Active person under an archived family — archive should cascade to members.
  const activeUnderArchived = await prisma.person.count({ where: { archivedAt: null, family: { archivedAt: { not: null } } } })
  activeUnderArchived === 0 ? ok("No active Person under archived Family") : bad("Active Person under archived Family", activeUnderArchived, "unarchive/re-archive the family")

  // ── 4. Nullable-but-assumed columns ───────────────────────────────────────
  console.log("\n4. Nullable-but-assumed (kind ⇒ required date/recurrence)")
  const oneOffNoDate = await prisma.event.count({ where: { kind: "one_off", date: null } })
  const recurringNoRecurs = await prisma.event.count({ where: { kind: "recurring", recurs: null } })
  oneOffNoDate === 0 ? ok("one_off Event has date") : bad("one_off Event with null date", oneOffNoDate)
  recurringNoRecurs === 0 ? ok("recurring Event has recurs") : bad("recurring Event with null recurs", recurringNoRecurs)

  console.log("\n" + "─".repeat(60))
  if (problems === 0) {
    console.log("✓ No data-integrity problems found.")
  } else {
    console.log(`✗ ${problems} row(s) across the failing checks above need attention.`)
  }
  console.log(
    "\nMigration drift is a separate offline check — run against the prod schema:\n" +
      "  npx prisma migrate diff \\\n" +
      "    --from-url \"$DATABASE_URL\" --to-schema-datamodel prisma/schema.prisma --exit-code\n" +
      "  (exit 2 = drift between the live DB and schema.prisma)",
  )

  await prisma.$disconnect()
  process.exit(problems === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
