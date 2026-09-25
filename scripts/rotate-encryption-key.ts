import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, decrypt, keyIdOf, currentKeyId } from "../src/lib/cryptoCore"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const BATCH = 100
const APPLY = process.argv.includes("--apply")
const CONFIRMED = process.argv.includes("--yes")
const CURRENT = currentKeyId()

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL!).host
  } catch {
    return "(unparseable DATABASE_URL)"
  }
}

// Encrypted columns per model — must cover every encrypted field.
// Canonical models: family, person, transaction, receiptSend, registration,
// pettyCashExpense, pettyCashReceipt, pettyCashTransfer, familyUpdateSubmission,
// membershipApplication, dgrReceipt, transactionAttachment.
// A field encrypted on write but omitted here is silently left on the old key id
// and becomes undecryptable once that key is retired. The
// encryption-coverage test (__tests__/scripts/encryption-coverage.test.ts)
// greps every `encrypt(...)` write site and fails CI if a new field is missing
// from this map — that guard is what keeps this list from drifting.
export const FIELDS: Record<string, string[]> = {
  family: ["address", "suburb", "state", "postcode", "homePhone", "notes"],
  // notes added: Person.notes was never encrypted at all — the field
  // name is reused by other models sharing this map, so the coverage-guard
  // test was already green on the field-name grep, but Person specifically
  // was never re-keyed without this entry (the exact "passes the grep, stays
  // un-rotated" trap warned about).
  person: [
    "email", "dateOfBirth", "mobile", "workPhone", "homePhone", "notes",
    "pastoralNotes", "emergencyContactName", "emergencyContactPhone",
  ],
  // notes: encrypted at write in bankImportConfirm.ts and the manual transaction
  // action. Field name "notes" is also used by petty-cash models, so the
  // coverage guard was already green, but the transaction delegate must list it
  // or transaction.notes ciphertext is never re-keyed.
  transaction: ["description", "notes"],
  receiptSend: ["sentTo"],
  paymentReminderSend: ["sentTo"],
  // customAnswers is encrypt(JSON.stringify(...)) written in
  // eventRegistration.ts's persistRegistration — was omitted here,
  // leaving it on the old key id forever once that key is retired.
  registration: ["email", "phone", "customAnswers"],
  // Added in the audit-5 encryption batch — were silently
  // omitted here, so rotation left them on the old key id. Delegate
  // lookup is generic via (prisma as any)[name], so adding entries is enough.
  pettyCashExpense: ["payee", "description"],
  pettyCashReceipt: ["notes"],
  pettyCashTransfer: ["depositedByName", "notes"],
  // payload is encrypt(JSON.stringify(...)) stored as a string scalar in a Json
  // column; rotateRow skips non-string (legacy plaintext-object) values.
  familyUpdateSubmission: ["payload"],
  // Entire model was missing — written encrypted in
  // src/lib/actions/membership.ts::submitMembershipApplication.
  membershipApplication: ["payload", "signature", "email", "mobile"],
  // Orphans caught by the coverage guard: donorEmail is encrypted in
  // dgrReceipt.ts; filename in transactionAttachment.ts. Both plain strings that
  // rotate cleanly. TransactionAttachment.data is the encrypted blob — a BYTEA
  // column holding `Buffer.from(encrypt(base64), "utf8")`. It IS re-keyed now via
  // the blob path; it's listed in BLOB_FIELDS below so rotateRow decodes
  // the Buffer, re-encrypts, and writes a Buffer back.
  dgrReceipt: ["donorEmail"],
  transactionAttachment: ["filename", "data"],
}

// Fields in FIELDS whose column type is BYTEA, not TEXT — the ciphertext string
// is stored as UTF-8 bytes. rotateRow decodes these to a string, re-keys, and
// writes a Buffer back (a plain-string re-encrypt would corrupt the column).
export const BLOB_FIELDS: Record<string, string[]> = {
  transactionAttachment: ["data"],
}

// Returns the re-encrypted update for one row, or null if nothing to do.
// blobFields names the BYTEA columns among `fields`: their value is a Buffer
// (UTF-8 bytes of the ciphertext string), re-keyed and written back as a Buffer.
function rotateRow(
  row: Record<string, unknown>,
  fields: string[],
  blobFields: Set<string> = new Set(),
): Record<string, string | Buffer> | null {
  const update: Record<string, string | Buffer> = {}
  for (const f of fields) {
    const val = row[f]
    if (blobFields.has(f)) {
      if (!Buffer.isBuffer(val)) continue
      const str = val.toString("utf8")
      const kid = keyIdOf(str)
      if (kid && kid !== CURRENT) update[f] = Buffer.from(encrypt(decrypt(str)), "utf8")
      continue
    }
    if (typeof val !== "string") continue
    const kid = keyIdOf(val)
    if (kid && kid !== CURRENT) {
      update[f] = encrypt(decrypt(val))
    }
  }
  return Object.keys(update).length ? update : null
}

// Structural shape of the three Prisma model-delegate methods rotateModel uses.
// Avoids `any` on the opts type; the dynamic `prisma[name]` lookup still needs a
// localized cast since the key is resolved at runtime from FIELDS.
type ModelDelegate = {
  count(): Promise<number>
  findMany(args: unknown): Promise<Record<string, unknown>[]>
  update(args: unknown): unknown
}

type RotateOpts = {
  delegate?: ModelDelegate
  runTx?: (ops: unknown[]) => Promise<unknown>
  apply?: boolean
}

export async function rotateModel(
  name: keyof typeof FIELDS,
  opts: RotateOpts = {},
): Promise<{ changed: number; badRows: number }> {
  const fields = FIELDS[name]
  const blobFields = new Set(BLOB_FIELDS[name] ?? [])
  const delegate = opts.delegate ?? ((prisma as unknown as Record<string, ModelDelegate>)[name])
  const runTx = opts.runTx ?? ((ops: unknown[]) => prisma.$transaction(ops as any))
  const apply = opts.apply ?? APPLY
  if (!delegate) throw new Error(`Unknown model: ${String(name)}`)
  const total: number = await delegate.count()
  // id + rotated fields only — avoid pulling unrelated PII columns into memory.
  const select = { id: true, ...Object.fromEntries(fields.map((f) => [f, true])) }
  let done = 0
  let changed = 0
  let badRows = 0
  while (done < total) {
    // Stable order so OFFSET pagination can't skip or duplicate rows.
    const rows: Record<string, unknown>[] = await delegate.findMany({
      orderBy: { id: "asc" },
      skip: done,
      take: BATCH,
      select,
    })
    // Build the batch's update ops, then commit them in ONE transaction. A
    // per-row update outside any transaction (the previous behaviour) could be
    // interrupted mid-model and leave a mixed-key state; batching bounds any
    // interruption to whole-batch boundaries.
    const ops: unknown[] = []
    for (const row of rows) {
      // decrypt() throws on a malformed/corrupted ciphertext (bad auth
      // tag, truncated base64, unrecognized key-id segment). Previously that
      // exception propagated out of this loop, out of rotateModel, and
      // aborted the ENTIRE run — every model that hadn't run yet stayed on
      // the old key id. Isolate each row: a bad row is skipped and counted,
      // never lets one row block the rest of the model or later models.
      let update: Record<string, string | Buffer> | null
      try {
        update = rotateRow(row, fields, blobFields)
      } catch (e) {
        badRows++
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`${name} #${row.id}: could not rotate (${msg}) — skipped`)
        continue
      }
      if (update) {
        changed++
        if (apply) ops.push(delegate.update({ where: { id: row.id }, data: update }))
      }
    }
    if (apply && ops.length) {
      await runTx(ops)
      console.log(`${name}: committed batch of ${ops.length} (through ${done + rows.length}/${total})`)
    }
    done += rows.length
  }
  console.log(
    `${name}: ${changed} row(s) ${apply ? "re-encrypted" : "would be re-encrypted"} (of ${total})` +
      (badRows ? `, ${badRows} row(s) skipped (malformed ciphertext)` : ""),
  )
  return { changed, badRows }
}

async function main() {
  console.log(`Rotating encrypted values to current key id "${CURRENT}" — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost()}`)
  if (APPLY && !CONFIRMED) {
    console.error(
      `Refusing to --apply without --yes. Verify the target host above is correct, then re-run with --apply --yes.`,
    )
    await prisma.$disconnect()
    process.exit(1)
  }
  // iterate every model even if an earlier one hit bad rows — a single
  // malformed ciphertext must never abort rotation for models that haven't
  // run yet. Bad rows are collected across the whole run and summarized below.
  let totalBadRows = 0
  for (const name of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
    const { badRows } = await rotateModel(name)
    totalBadRows += badRows
  }
  if (totalBadRows > 0) {
    console.error(
      `${totalBadRows} row(s) across all models had malformed/undecryptable ciphertext and were ` +
        `skipped — investigate before retiring the old key (a row skipped here stays on its current ` +
        `key id forever).`,
    )
  }
  if (APPLY) {
    // record the rotation in container stdout / Log Analytics. No DB
    // AuditLog row — this is a CLI op with no authenticated user, and
    // AuditLog.userId is a required FK.
    console.log(JSON.stringify({
      event: "ENCRYPTION_KEY_ROTATION",
      at: new Date().toISOString(),
      toKeyId: CURRENT,
      dbHost: dbHost(),
    }))
    console.log("Done.")
    console.log(
      `Before retiring an old key: promote ENCRYPTION_KEY to an explicit ` +
        `ENCRYPTION_KEY_V1=<same key> and re-run this script (dry run) to confirm ` +
        `0 rows remain on old key ids. Never delete ENCRYPTION_KEY while v1 data remains.`,
    )
  } else {
    console.log("Dry run complete. Re-run with --apply --yes to write.")
  }
  await prisma.$disconnect()
  // non-zero exit whenever any row was skipped, in BOTH dry-run and
  // apply — a bad row is a real finding that must not be lost in green CI
  // output, even though the rest of the rotation still completed.
  if (totalBadRows > 0) process.exit(1)
}

// Jest sets NODE_ENV=test; skip the auto-run so the module can be imported for
// unit testing without connecting to a DB or parsing the runner's argv.
if (process.env.NODE_ENV !== "test") {
  main().catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
}
