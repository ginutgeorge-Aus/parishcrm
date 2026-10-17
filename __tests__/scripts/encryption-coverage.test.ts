/** @jest-environment node */
// Key-rotation coverage guard. The recurring defect
// is a field encrypted on write but forgotten in rotate-encryption-key.ts's
// FIELDS map — silently left on the old key id and undecryptable once that key
// is retired. The FIELDS-vs-CANONICAL test in rotate-encryption-key.test.ts
// catches drift between two hand-maintained lists, but neither list is derived
// from the actual write sites, so a brand-new `encrypt(...)` call site can be
// added without either turning red.
//
// This test closes that gap: it greps every encrypt() write target out of the
// source tree and asserts each one is covered by the rotation FIELDS map (or an
// explicit allowlist). Add a new encrypted field without updating FIELDS → this
// fails CI.
//
// Model-qualified where possible: when the write sits inside a Prisma write call
// (`x.<model>.create/update/upsert/...({ ... })`), it must be in FIELDS[model],
// and a blob write (encryptBytes / Buffer.from(encrypt(...))) must also be in
// BLOB_FIELDS[model]. Otherwise a new model writing a reused field name (e.g.
// `data: encryptBytes(x)`, already rotated for transactionAttachment) would pass
// while its rows are never re-keyed. Writes built in a separate object or a
// generic helper (person.ts::encryptPersonFields, familyFields.ts) show no model
// at the call site, so those fall back to field-name granularity: covered if ANY
// model rotates that name.

import * as fs from "fs"
import * as path from "path"

const SRC = path.join(__dirname, "../../src")

// Write targets encrypted at rest but NOT in FIELDS by design, as bare field
// names (unresolved sites) or `model.field` (resolved sites). Empty for now.
const ALLOWLIST = new Set<string>()

/**
 * Lists non-test TS/TSX source files under `dir`, skipping generated code and
 * the crypto modules (they define encrypt/decrypt, no field write sites).
 * @param dir - directory to walk
 */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "generated" || entry.name === "__tests__") continue
      out.push(...walk(full))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      if (/crypto(Core)?\.ts$/.test(entry.name)) continue
      out.push(full)
    }
  }
  return out
}

// Match `foo: encrypt(`, `foo: Buffer.from(encrypt(`, `foo: encryptBytes(` and `x.foo = encrypt(`/`encryptBytes(`.
const WRITE_RE = /(?:(\w+)\s*:\s*(Buffer\.from\(\s*)?encrypt(Bytes)?\()|(?:\.(\w+)\s*=\s*encrypt(Bytes)?\()/g
// A Prisma delegate write call, e.g. `prisma.waitlist.create(` or `tx.invoice.updateMany(`.
const CALL_RE = /\.(\w+)\.(?:create|createMany|update|updateMany|upsert)\(/g

type WriteSite = { model: string | null; field: string; blob: boolean; where: string }

/**
 * Model of the innermost Prisma write call whose argument list still encloses
 * `pos` (bracket depth > 0), or null when the write isn't inside one.
 * @param text - file source
 * @param pos - offset of the encrypt write match
 */
export function enclosingModel(text: string, pos: number): string | null {
  let model: string | null = null
  for (const call of text.matchAll(CALL_RE)) {
    const open = call.index + call[0].length - 1
    if (open >= pos) break
    let depth = 0
    for (let i = open; i < pos; i++) {
      const ch = text[i]
      if (ch === "(" || ch === "{" || ch === "[") depth++
      else if (ch === ")" || ch === "}" || ch === "]") depth--
      if (depth === 0) break
    }
    if (depth > 0) model = call[1]
  }
  return model
}

/**
 * Every encrypt() write target in `src`, with its model when the call site shows it.
 */
function encryptedWriteSites(): WriteSite[] {
  const sites: WriteSite[] = []
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, "utf8")
    for (const m of text.matchAll(WRITE_RE)) {
      const field = m[1] ?? m[4]
      if (!field) continue
      const blob = Boolean(m[2] || m[3] || m[5])
      sites.push({ model: enclosingModel(text, m.index), field, blob, where: path.relative(SRC, file) })
    }
  }
  return sites
}

describe("encryption coverage", () => {
  it("every encrypt() write site is in the rotation FIELDS map (or allowlisted)", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db" // never connected — FIELDS is a static export
    const { FIELDS, BLOB_FIELDS } = await import("../../scripts/rotate-encryption-key")
    const anyModel = new Set(Object.values(FIELDS).flat())

    const sites = encryptedWriteSites()
    // Sanity: the grep must actually find write sites, and resolve models for
    // many of them, else a bad regex would vacuously pass and the guard would be dead.
    expect(sites.length).toBeGreaterThan(30)
    expect(sites.filter((s) => s.model).length).toBeGreaterThan(20)

    const uncovered = new Set<string>()
    for (const s of sites) {
      if (!s.model) {
        if (!anyModel.has(s.field) && !ALLOWLIST.has(s.field)) uncovered.add(`${s.field} (${s.where})`)
        continue
      }
      const key = `${s.model}.${s.field}`
      if (ALLOWLIST.has(key)) continue
      if (!FIELDS[s.model]?.includes(s.field)) uncovered.add(`${key} (${s.where})`)
      else if (s.blob && !BLOB_FIELDS[s.model]?.includes(s.field)) uncovered.add(`${key} blob (${s.where})`)
    }
    // A non-empty list means a field is encrypted on write but not rotated: add
    // it to FIELDS (and BLOB_FIELDS for BYTEA) in scripts/rotate-encryption-key.ts
    // and CANONICAL in rotate-encryption-key.test.ts, or to ALLOWLIST with a reason.
    expect([...uncovered].sort()).toEqual([])
  })

  it("resolves the model of a write nested in a Prisma call, not a sibling call", () => {
    const text = `await prisma.waitlist.create({ data: { email: encrypt(e), meta: { a: 1 } } })
      await tx.invoice.update({ where: { id }, data: { notes: encrypt(n) } })
      const data = { mobile: encrypt(m) }`
    expect(enclosingModel(text, text.indexOf("email:"))).toBe("waitlist")
    expect(enclosingModel(text, text.indexOf("notes:"))).toBe("invoice")
    expect(enclosingModel(text, text.indexOf("mobile:"))).toBeNull()
  })
})
