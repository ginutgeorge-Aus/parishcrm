/**
 * Read-only pre-migration safety check for
 * 20260819000000_add_user_archivedat_and_pettycash_importkey_unique.
 *
 * That migration promotes PettyCashReceipt.importKey and
 * PettyCashExpense.importKey from a plain index to a UNIQUE index. Postgres
 * treats NULLs as distinct, so only NON-NULL duplicate importKey values would
 * make the CREATE UNIQUE INDEX fail. Reports any such duplicates so they can be
 * resolved before `migrate deploy` runs on tag.
 *
 * Usage: DATABASE_URL=<target> npx tsx scripts/check-pettycash-importkey-dups.ts
 * Uses the raw pg driver, read-only, no Prisma engine. Makes no writes.
 */
import { Client } from "pg"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL not set")
  const client = new Client({ connectionString: url })
  await client.connect()

  let bad = 0
  for (const table of ["PettyCashReceipt", "PettyCashExpense"]) {
    const { rows } = await client.query(
      `SELECT "importKey", COUNT(*)::int AS n
       FROM "${table}"
       WHERE "importKey" IS NOT NULL
       GROUP BY "importKey"
       HAVING COUNT(*) > 1
       ORDER BY n DESC`,
    )
    if (rows.length === 0) {
      console.log(`OK  ${table}: 0 duplicate non-null importKey values`)
    } else {
      bad += rows.length
      console.log(`BAD ${table}: ${rows.length} duplicated importKey value(s):`)
      for (const r of rows) console.log(`    ${r.importKey} x ${r.n}`)
    }
  }
  await client.end()
  if (bad > 0) {
    console.log(`\nMIGRATION WOULD FAIL - resolve ${bad} duplicate group(s) before tagging.`)
    process.exit(1)
  }
  console.log("\nSAFE - unique index will build cleanly.")
}

main().catch((e) => {
  console.error(String(e))
  process.exit(2)
})
