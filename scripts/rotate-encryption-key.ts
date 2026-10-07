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
  // TOTP authenticator secrets (src/lib/actions/totp.ts). Both are plain
  // encrypt(base32) strings; pending is short-lived but must still rotate.
  user: ["totpSecret", "totpPendingSecret"],
  // Child-safety clearances (src/lib/actions/clearance.ts). `document` is a
  // BYTEA blob like transactionAttachment.data — see BLOB_FIELDS.
  personClearance: ["number", "documentName", "document", "verificationNote"],
}

// Fields in FIELDS whose column type is BYTEA, not TEXT — the ciphertext string
// is stored as UTF-8 bytes. rotateRow decodes these to a string, re-keys, and
// writes a Buffer back (a plain-string re-encrypt would corrupt the column).
export const BLOB_FIELDS: Record<string, string[]> = {
  transactionAttachment: ["data"],
  personClearance: ["document"],
}

// Returns the re-encrypted update for one row, or null if nothing to do.
// blobFields names the BYTEA columns among `fields`: their value is a Buffer or
// Uint8Array
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
      // Prisma 7 may hand BYTEA back as a plain Uint8Array; Buffer is a subclass,
      // so one instanceof check covers both.
      if (!(val instanceof Uint8Array)) continue
      const str = Buffer.from(val).toString("utf8")
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

// Structural shape of the Prisma model-delegate methods rotateModel uses.
// Avoids `any` on the opts type; the dynamic `prisma[name]` lookup still needs a
// localized cast since the key is resolved at runtime from FIELDS.
type ModelDelegate = {
  count(): Promise<number>
  findMany(args: unknown): Promise<Record<string, unknown>[]>
  updateMany(args: unknown): unknown
}

type RotateOpts = {
  delegate?: ModelDelegate
  runTx?: (ops: unknown[]) => Promise<unknown>
  apply?: boolean
}

// How many times a row that changed between read and write is re-read and
// retried before it is reported as a conflict.
const MAX_CONFLICT_RETRIES = 3

/**
 * Builds the conditional write for one row: match the id AND the exact
 * ciphertext that was read for every column being rewritten (#166). If a user
 * saved the row in between, the ciphertext differs (fresh random IV on every
 * encrypt), the update matches 0 rows, and the stale re-encrypted copy is never
 * written over their edit. Comparing the rewritten columns works for every
 * model, with or without `updatedAt`, and covers exactly the columns that could
 * be clobbered — unencrypted columns are never written here.
 *
 * @param row - the row as read (id + encrypted columns)
 * @param update - the re-encrypted values from rotateRow
 * @returns updateMany args guarded on the read ciphertext
 */
function guardedWrite(row: Record<string, unknown>, update: Record<string, string | Buffer>) {
  const where: Record<string, unknown> = { id: row.id }
  // `{ equals }`, not the bare-value shorthand: some rotated columns are Json
  // (payload, customAnswers), whose filter has no shorthand; String and Bytes
  // filters accept `equals` too.
  for (const f of Object.keys(update)) where[f] = { equals: row[f] }
  return { where, data: update }
}

/**
 * Rows touched by one conditional updateMany, from a $transaction result.
 *
 * @param res - one element of the $transaction result array
 * @returns the affected-row count, or 0 if the shape is unexpected
 */
function countOf(res: unknown): number {
  const count = (res as { count?: unknown } | undefined)?.count
  return typeof count === "number" ? count : 0
}

/**
 * Re-reads a row whose guarded write matched nothing and retries the rotation
 * against its fresh ciphertext, up to MAX_CONFLICT_RETRIES times.
 *
 * @returns "written" if a retry committed; "resolved" if the row no longer
 *   needs rotating (deleted, or the user's save already used the current key);
 *   "bad" if the fresh value won't decrypt; "conflict" if it kept changing.
 */
async function retryConflict(
  name: string,
  id: unknown,
  ctx: {
    fields: string[]
    blobFields: Set<string>
    select: Record<string, true>
    delegate: ModelDelegate
    runTx: (ops: unknown[]) => Promise<unknown>
  },
): Promise<"written" | "resolved" | "bad" | "conflict"> {
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
    const [fresh] = await ctx.delegate.findMany({ where: { id }, take: 1, select: ctx.select })
    if (!fresh) return "resolved"
    let update: Record<string, string | Buffer> | null
    try {
      update = rotateRow(fresh, ctx.fields, ctx.blobFields)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`${name} #${String(id)}: could not rotate (${msg}) — skipped`)
      return "bad"
    }
    if (!update) return "resolved"
    const results = (await ctx.runTx([ctx.delegate.updateMany(guardedWrite(fresh, update))])) as unknown[] | undefined
    if (countOf(results?.[0]) === 1) return "written"
  }
  console.warn(
    `${name} #${String(id)}: changed concurrently on ${MAX_CONFLICT_RETRIES} retries — skipped (re-run to rotate it)`,
  )
  return "conflict"
}

/**
 * Re-encrypts every FIELDS column of one model that is on an old key id. Each
 * batch commits in one transaction, and every write is guarded on the
 * ciphertext that was read, so a concurrent user edit is never reverted: a row
 * that changed is re-read and retried, and reported as a conflict if it keeps
 * changing.
 *
 * @param name - FIELDS key (camelCase Prisma delegate name)
 * @param opts - test seams: delegate, runTx, apply (defaults from argv)
 * @returns rows (that would be) re-encrypted, malformed rows skipped, and rows
 *   skipped because they kept changing under the rotation
 */
export async function rotateModel(
  name: keyof typeof FIELDS,
  opts: RotateOpts = {},
): Promise<{ changed: number; badRows: number; conflicts: number }> {
  const fields = FIELDS[name]
  const blobFields = new Set(BLOB_FIELDS[name] ?? [])
  const delegate = opts.delegate ?? ((prisma as unknown as Record<string, ModelDelegate>)[name])
  const runTx = opts.runTx ?? ((ops: unknown[]) => prisma.$transaction(ops as any))
  const apply = opts.apply ?? APPLY
  if (!delegate) throw new Error(`Unknown model: ${String(name)}`)
  const total: number = await delegate.count()
  // id + rotated fields only — avoid pulling unrelated PII columns into memory.
  const select: Record<string, true> = { id: true, ...Object.fromEntries(fields.map((f) => [f, true])) }
  let done = 0
  let changed = 0
  let badRows = 0
  let conflicts = 0
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
    const opRows: Record<string, unknown>[] = []
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
      if (!update) continue
      if (!apply) {
        changed++
        continue
      }
      ops.push(delegate.updateMany(guardedWrite(row, update)))
      opRows.push(row)
    }
    if (ops.length) {
      const results = ((await runTx(ops)) as unknown[] | undefined) ?? []
      let missed = 0
      for (let i = 0; i < opRows.length; i++) {
        if (countOf(results[i]) === 1) {
          changed++
          continue
        }
        // Row changed (or vanished) since the batch read — re-read and retry it
        // alone rather than overwrite the user's edit with stale ciphertext.
        missed++
        const outcome = await retryConflict(name, opRows[i].id, { fields, blobFields, select, delegate, runTx })
        if (outcome === "written") changed++
        else if (outcome === "bad") badRows++
        else if (outcome === "conflict") conflicts++
      }
      console.log(
        `${name}: committed batch of ${ops.length} (through ${done + rows.length}/${total})` +
          (missed ? `, ${missed} changed concurrently and were retried` : ""),
      )
    }
    done += rows.length
  }
  console.log(
    `${name}: ${changed} row(s) ${apply ? "re-encrypted" : "would be re-encrypted"} (of ${total})` +
      (badRows ? `, ${badRows} row(s) skipped (malformed ciphertext)` : "") +
      (conflicts ? `, ${conflicts} row(s) skipped (kept changing during rotation)` : ""),
  )
  return { changed, badRows, conflicts }
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
  let totalConflicts = 0
  for (const name of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
    const { badRows, conflicts } = await rotateModel(name)
    totalBadRows += badRows
    totalConflicts += conflicts
  }
  if (totalBadRows > 0) {
    console.error(
      `${totalBadRows} row(s) across all models had malformed/undecryptable ciphertext and were ` +
        `skipped — investigate before retiring the old key (a row skipped here stays on its current ` +
        `key id forever).`,
    )
  }
  if (totalConflicts > 0) {
    console.error(
      `${totalConflicts} row(s) kept changing during rotation and were left untouched (no edit was ` +
        `overwritten). Re-run the script to rotate them.`,
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
  // Same for rows skipped on a concurrent-edit conflict: they stay on the old
  // key id until a re-run picks them up.
  if (totalBadRows > 0 || totalConflicts > 0) process.exit(1)
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
