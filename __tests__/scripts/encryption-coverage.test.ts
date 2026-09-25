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
// source tree and asserts each field name is covered by the rotation FIELDS map
// (or an explicit allowlist). Add a new encrypted field without updating
// FIELDS → this fails CI.
//
// Field-name granularity (not model.field): several fields are encrypted via
// generic helpers (person.ts::encryptPersonFields, familyUpdate.ts) where the
// model isn't visible at the call site, so mapping a bare field name back to a
// model is unreliable. The trade-off: a field name reused across models is
// considered covered if ANY model rotates it. Acceptable — the class we're
// killing is "a NEW field name is never added to FIELDS at all".

import * as fs from "fs"
import * as path from "path"

const SRC = path.join(__dirname, "../../src")

// Field names encrypted at rest but NOT present in FIELDS by design. Empty now
// that TransactionAttachment.data (BYTEA blob) is re-keyed via the blob path
// and listed in the rotation FIELDS/BLOB_FIELDS maps.
const ALLOWLIST = new Set<string>()

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "generated" || entry.name === "__tests__") continue
      out.push(...walk(full))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      // The crypto modules DEFINE encrypt/decrypt — no field write sites there.
      if (/crypto(Core)?\.ts$/.test(entry.name)) continue
      out.push(full)
    }
  }
  return out
}

// Match `foo: encrypt(`, `foo: Buffer.from(encrypt(` and `x.foo = encrypt(`.
const WRITE_RE = /(?:(\w+)\s*:\s*(?:Buffer\.from\(\s*)?encrypt\()|(?:\.(\w+)\s*=\s*encrypt\()/g

function encryptedWriteFields(): Set<string> {
  const fields = new Set<string>()
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, "utf8")
    for (const m of text.matchAll(WRITE_RE)) {
      const name = m[1] ?? m[2]
      if (name) fields.add(name)
    }
  }
  return fields
}

describe("encryption coverage", () => {
  it("every encrypt() write-site field is in the rotation FIELDS map (or allowlisted)", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db" // never connected — FIELDS is a static export
    const { FIELDS } = await import("../../scripts/rotate-encryption-key")
    const covered = new Set(Object.values(FIELDS).flat())

    const found = encryptedWriteFields()
    // Sanity: the grep must actually find write sites, else a bad glob would
    // vacuously pass and the guard would be dead.
    expect(found.size).toBeGreaterThan(10)

    const uncovered = [...found].filter((f) => !covered.has(f) && !ALLOWLIST.has(f)).sort()
    // A non-empty list here means a field is encrypted on write but not rotated:
    // add it to FIELDS in scripts/rotate-encryption-key.ts (and CANONICAL in
    // rotate-encryption-key.test.ts), or to ALLOWLIST with a reason.
    expect(uncovered).toEqual([])
  })
})
