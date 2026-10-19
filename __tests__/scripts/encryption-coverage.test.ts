/** @jest-environment node */
// Key-rotation coverage guard. The recurring defect
// is a field encrypted on write but forgotten in rotate-encryption-key.ts's
// FIELDS map — silently left on the old key id and undecryptable once that key
// is retired. The FIELDS-vs-CANONICAL test in rotate-encryption-key.test.ts
// catches drift between two hand-maintained lists, but neither list is derived
// from the actual write sites, so a brand-new `encrypt(...)` call site can be
// added without either turning red.
//
// This test closes that gap: it scans every encrypt() write target out of the
// source tree and asserts each one is covered by the rotation FIELDS map (or an
// explicit allowlist). Add a new encrypted field without updating FIELDS → this
// fails CI.
//
// Model-qualified where possible: when the write sits inside a Prisma write call
// (`x.<model>.create/update/upsert/...({ ... })`), it must be in FIELDS[model],
// and a blob write (encryptBytes / Buffer.from(encrypt(...))) must also be in
// BLOB_FIELDS[model]. Otherwise a new model writing a reused field name (e.g.
// `data: encryptBytes(x)`, already rotated for transactionAttachment) would pass
// while its rows are never re-keyed. Writes built in a separate object, a
// generic helper (person.ts::encryptPersonFields, familyFields.ts) or a nested
// relation write (`attendees: { create: ... }`) show no model at the call site,
// so those fall back to field-name granularity: covered if ANY model rotates that
// name.

import * as fs from "fs"
import * as path from "path"
import ts from "typescript"

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

// The scanner walks the TypeScript AST, so comments, strings, templates and arbitrarily nested
// parens/brackets can never confuse it. A write is an object-literal key whose value calls
// encrypt/encryptBytes/encryptOrNull (directly or inside a conditional/call/wrapper, but not inside a
// nested object literal or block, which have their own keys), or a property assignment
// `x.foo = encrypt(...)` (optionally wrapped in `Buffer.from(`).
// Not seen: keys assigned in a loop (`d[k] = encrypt(...)`, familyUpdate.ts / person.ts helpers), whose
// fields are pinned by CANONICAL in rotate-encryption-key.test.ts instead.
const ENCRYPT_FNS = new Set(["encrypt", "encryptBytes", "encryptOrNull"])
// A Prisma delegate write method, e.g. the `create` of `prisma.waitlist.create(`.
const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert"])
// A nested relation write (`attendees: { create: ... }`): rows there belong to the related model, not the call's.
const NESTED_KEYS = new Set(["create", "createMany", "connectOrCreate", "upsert", "update", "updateMany"])
// Prisma delegate names (camelCase model names), so a `.cache.update(` helper call is never taken for a model.
const MODELS = new Set(
  [...fs.readFileSync(path.join(__dirname, "../../prisma/schema.prisma"), "utf8").matchAll(/^model\s+(\w+)/gm)]
    .map((m) => m[1][0].toLowerCase() + m[1].slice(1)),
)

type WriteSite = { model: string | null; field: string; blob: boolean; where: string }

/**
 * Name of a property key node when it is a plain identifier or string literal.
 * @param name - property name node
 */
function keyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
}

/**
 * The encrypt call `node` itself is: encrypt/encryptBytes/encryptOrNull, or a `Buffer.from(` wrapper of one.
 * @param node - expression to test
 * @param direct - passed through to the wrapped argument's search
 */
function encryptCall(node: ts.Node, direct: boolean): { blob: boolean } | null {
  if (!ts.isCallExpression(node)) return null
  const callee = node.expression
  if (ts.isIdentifier(callee) && ENCRYPT_FNS.has(callee.text)) return { blob: callee.text === "encryptBytes" }
  const isBufferFrom = ts.isPropertyAccessExpression(callee) && callee.getText() === "Buffer.from"
  return isBufferFrom && node.arguments[0] && findEncrypt(node.arguments[0], direct) ? { blob: true } : null
}

/**
 * The encrypt call a value expression reduces to, searching through conditionals, wrappers and call
 * arguments but not into nested object literals or blocks. `blob` is set for encryptBytes or a
 * `Buffer.from(` wrapper.
 * @param node - value expression
 * @param direct - only accept the expression itself or a `Buffer.from(` wrapper of it (assignments)
 */
function findEncrypt(node: ts.Node, direct = false): { blob: boolean } | null {
  const hit = encryptCall(node, direct)
  if (hit) return hit
  if (direct || ts.isObjectLiteralExpression(node) || ts.isBlock(node)) return null
  return ts.forEachChild(node, (child) => findEncrypt(child)) ?? null
}

/**
 * Whether `node` sits inside a nested relation write (`attendees: { create: ... }`) of the object literal `obj`.
 * @param obj - object literal on the path from `node` upwards
 * @param node - the write's key node
 */
function inNestedWrite(obj: ts.ObjectLiteralExpression, node: ts.Node): boolean {
  return obj.properties.some(
    (prop) =>
      ts.isPropertyAssignment(prop) && NESTED_KEYS.has(keyName(prop.name) ?? "") && prop.pos <= node.pos && node.end <= prop.end,
  )
}

/**
 * The Prisma model a write-shaped call (`<delegate>.<write>(`) targets: its delegate name when that is a
 * model, else null. Returns undefined when the call isn't write-shaped at all.
 * @param call - candidate call expression
 */
function writeCallModel(call: ts.CallExpression): string | null | undefined {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee) || !WRITE_METHODS.has(callee.name.text)) return undefined
  if (!ts.isPropertyAccessExpression(callee.expression)) return undefined
  const delegate = callee.expression.name.text
  return MODELS.has(delegate) ? delegate : null
}

/**
 * Model of the innermost write-shaped call whose arguments enclose `node`, or null when the write
 * isn't inside one, that call's delegate isn't a Prisma model (it never falls through to an outer
 * call), or it sits inside a nested relation write (its model isn't the call's, and the relation
 * name isn't a model name). A sibling key after a closed nested write still resolves to the call's model.
 * @param node - the write's key node
 */
function modelOf(node: ts.Node): string | null {
  for (let cur: ts.Node = node; cur.parent; cur = cur.parent) {
    const parent = cur.parent
    if (ts.isObjectLiteralExpression(cur) && ts.isPropertyAssignment(parent) && inNestedWrite(cur, node)) return null
    if (ts.isCallExpression(parent) && cur !== parent.expression) {
      const model = writeCallModel(parent)
      if (model !== undefined) return model
    }
  }
  return null
}

/**
 * The write site `node` is, if it is an encrypted property assignment or `x.foo = encrypt(...)`.
 * @param node - any AST node
 * @param where - label for the file
 */
function siteOf(node: ts.Node, where: string): WriteSite | null {
  if (ts.isPropertyAssignment(node)) {
    const field = keyName(node.name)
    const enc = field && findEncrypt(node.initializer)
    return field && enc ? { model: modelOf(node), field, blob: enc.blob, where } : null
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
    const enc = findEncrypt(node.right, true)
    return enc ? { model: modelOf(node), field: node.left.name.text, blob: enc.blob, where } : null
  }
  return null
}

/**
 * Every encrypt() write target in `text`, with its model when the call site shows it.
 * @param text - file source
 * @param where - label for the file, used in failure messages
 */
export function findWriteSites(text: string, where = "<inline>"): WriteSite[] {
  const kind = where.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(where, text, ts.ScriptTarget.Latest, true, kind)
  const sites: WriteSite[] = []
  const visit = (node: ts.Node): void => {
    const site = siteOf(node, where)
    if (site) sites.push(site)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return sites
}

/**
 * Every encrypt() write target in `src`, with its model when the call site shows it.
 */
function encryptedWriteSites(): WriteSite[] {
  return walk(SRC).flatMap((file) => findWriteSites(fs.readFileSync(file, "utf8"), path.relative(SRC, file)))
}

describe("encryption coverage", () => {
  it("every encrypt() write site is in the rotation FIELDS map (or allowlisted)", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db" // never connected — FIELDS is a static export
    const { FIELDS, BLOB_FIELDS } = await import("../../scripts/rotate-encryption-key")
    const anyModel = new Set(Object.values(FIELDS).flat())
    const anyBlob = new Set(Object.values(BLOB_FIELDS).flat())

    const sites = encryptedWriteSites()
    // Sanity: the scan must actually find write sites, and resolve models for
    // many of them, else a broken scanner would vacuously pass and the guard would be dead.
    expect(sites.length).toBeGreaterThan(30)
    expect(sites.filter((s) => s.model).length).toBeGreaterThan(20)

    const uncovered = new Set<string>()
    for (const s of sites) {
      if (!s.model) {
        if (ALLOWLIST.has(s.field)) continue
        if (!anyModel.has(s.field)) uncovered.add(`${s.field} (${s.where})`)
        else if (s.blob && !anyBlob.has(s.field)) uncovered.add(`${s.field} blob (${s.where})`)
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
    expect(findWriteSites(text).map((s) => [s.field, s.model])).toEqual([
      ["email", "waitlist"],
      ["notes", "invoice"],
      ["mobile", null],
    ])
  })

  it("leaves a nested relation write unresolved (its model isn't the outer call's)", () => {
    const text = "await tx.registrationItem.create({ data: { qty: 1, attendees: { create: rows.map((r) => ({ answers: encrypt(a) })) } } })"
    expect(findWriteSites(text).map((s) => s.model)).toEqual([null])
  })

  it("resolves a sibling key written after a closed nested relation write", () => {
    const text = "await prisma.registration.create({ data: { attendees: { create: [] }, email: encrypt(e) } })"
    expect(findWriteSites(text).map((s) => s.model)).toEqual(["registration"])
  })

  it("leaves an update-nested relation write unresolved", () => {
    const text = "await tx.person.update({ where: { id }, data: { family: { update: { notes: encrypt(n) } }, mobile: encrypt(m) } })"
    expect(findWriteSites(text).map((s) => [s.field, s.model])).toEqual([
      ["notes", null],
      ["mobile", "person"],
    ])
  })

  it("stops at the innermost write-shaped call even when its delegate isn't a model", () => {
    const text = "await prisma.waitlist.create({ data: { email: encrypt(e), extra: this.cache.update({ notes: encrypt(n) }) } })"
    expect(findWriteSites(text).map((s) => [s.field, s.model])).toEqual([
      ["email", "waitlist"],
      ["notes", null],
    ])
  })

  it("parses TSX only for .tsx files, defaulting inline text to TS", () => {
    expect(findWriteSites("const a = <T,>(x: T) => ({ k: encrypt(x) })").map((s) => s.field)).toEqual(["k"])
    expect(findWriteSites("const a = <div>{f({ k: encrypt(x) })}</div>", "x.tsx").map((s) => s.field)).toEqual(["k"])
  })

  it("ignores write-shaped calls on non-model delegates", () => {
    const text = "await this.cache.update({ notes: encrypt(n) })"
    expect(findWriteSites(text).map((s) => s.model)).toEqual([null])
  })

  it("matches conditional, wrapper and blob writes, not ternary branches", () => {
    const text = `const o = {
      notes: x ? encrypt(x) : null,
      contact: isAllowed(user, event) ? encrypt(c) : null,
      answers: list[idx]
        ? encrypt(JSON.stringify(list[idx]))
        : undefined,
      email: encryptOrNull(e),
      doc: Buffer.from(encrypt(b), "utf8"),
      data: encryptBytes(bytes),
      plain: other,
    }
    const v = ok ? null : encrypt(y)
    row.secret = encrypt(s)
    row.file = Buffer.from(encrypt(f))`
    expect(findWriteSites(text).map(({ field, blob }) => ({ field, blob }))).toEqual([
      { field: "notes", blob: false },
      { field: "contact", blob: false },
      { field: "answers", blob: false },
      { field: "email", blob: false },
      { field: "doc", blob: true },
      { field: "data", blob: true },
      { field: "secret", blob: false },
      { field: "file", blob: true },
    ])
  })

  it("matches a conditional whose condition nests parens more than one level deep", () => {
    const text = "const d = { secret: canUse(user, lookup(team)) ? encrypt(v) : null }"
    expect(findWriteSites(text).map((s) => s.field)).toEqual(["secret"])
  })

  it("is not thrown off by brackets in strings, templates or comments before a write", () => {
    const text = [
      "await prisma.waitlist.create({",
      '  data: { note: "unbalanced ) ] }", label: `x $' + '{"}"} (`, /* ) ) */ email: encrypt(e) },',
      "  // stray ( [ {",
      "})",
      "await tx.invoice.update({ data: { notes: encrypt(n) } })",
    ].join("\n")
    expect(findWriteSites(text).map((s) => [s.field, s.model])).toEqual([
      ["email", "waitlist"],
      ["notes", "invoice"],
    ])
  })

  it("ignores encrypt-shaped text in comments and strings", () => {
    const text = '// foo: encrypt(x)\nconst s = "bar: encrypt(y)"\nconst t = `baz: encrypt(z)`'
    expect(findWriteSites(text)).toEqual([])
  })
})
