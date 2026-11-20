/**
 * @jest-environment node
 *
 * AUD-7-07 role matrix. GENERATED from source: scans every src/lib/actions/*.ts,
 * finds each exported async function that opens with a negated roleGuard check
 * (`if (!canX(session?.user?.role)) ...` or `canX(...) === false` before any DB
 * access; comments and strings ignored), and for every role that the REAL
 * roleGuard helpers refuse, asserts the action performs no Prisma write. Writes
 * are model write methods, `$executeRaw*`, and `$queryRaw*` whose SQL writes or locks;
 * `$transaction` itself is not a write, only what runs inside it (the callback gets a distinct `tx`
 * object without `$transaction`, like Prisma's). A guard refusal must also make no Prisma call at
 * all, read or write, so a refusal cannot be a downstream failure on a mocked read. Covers OFFICE_ADMIN being refused on admin-only / PASTOR+ADMIN
 * actions (the audit's nearest-miss role). roleGuard is never mocked.
 */
import fs from "node:fs"
import path from "node:path"
import { UserRole } from "@/lib/generated/prisma/enums"
import * as roleGuard from "@/lib/roleGuard"

type Role = (typeof UserRole)[keyof typeof UserRole]

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "$executeRaw",
  "$executeRawUnsafe",
])
/** Raw SQL that mutates state (INSERT/UPDATE/DELETE, advisory locks); a plain SELECT is a read. */
const RAW_WRITE_SQL =
  /\b(insert|update|delete|truncate|alter|drop|create|merge|copy|lock|set_config|nextval|setval)\b|\bfor\s+(share|no\s+key)\b|\binto\b|pg_(try_)?advisory/i

/**
 * True when a `$queryRaw` / `$queryRawUnsafe` call carries SQL that writes. Tagged templates pass a
 * strings array first; the Unsafe form passes the SQL string itself.
 * @param args the arguments the mocked raw-query method received
 */
function rawQueryWrites(args: unknown[]): boolean {
  const first = args[0]
  // Any other shape (e.g. a Prisma.sql object) cannot be inspected here: count it as a write.
  if (!Array.isArray(first) && typeof first !== "string") return true
  const sql = Array.isArray(first) ? first.join(" ") : first
  return RAW_WRITE_SQL.test(sql)
}
const writes: string[] = []
/** Every Prisma call (read or write): a guard refusal happens before any of them. */
const dbCalls: string[] = []
let currentRole: Role | undefined
/** Rows the mocked `findMany` returns; empty unless a case needs a non-empty read to prove a refusal. */
let findManyRows: unknown[] = []

jest.mock("server-only", () => ({}))
jest.mock("@/auth", () => ({
  auth: jest.fn(async () => ({ user: { id: "actor-1", role: currentRole, email: "a@example.com" } })),
  signIn: jest.fn(),
  signOut: jest.fn(),
  unstable_update: jest.fn(),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), revalidateTag: jest.fn(), unstable_cache: (f: unknown) => f }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((u: string) => {
    throw new Error(`REDIRECT:${u}`)
  }),
  notFound: jest.fn(() => {
    throw new Error("NOT_FOUND")
  }),
}))
jest.mock("@/lib/prisma", () => {
  const model = (name: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          jest.fn(async () => {
            dbCalls.push(`${name}.${method}`)
            if (WRITE_METHODS.has(method)) writes.push(`${name}.${method}`)
            return method.startsWith("find") ? (method === "findMany" ? findManyRows : null) : method === "count" ? 0 : undefined
          }),
      },
    )
  /**
   * Build a mocked Prisma client. The root client supports `$transaction`; an interactive
   * transaction's `tx` is a separate object WITHOUT `$transaction` (like Prisma's real
   * `TransactionClient`), so a nested `$transaction` or a use of the root client in place of `tx`
   * is visible. Writes made through either are recorded; the $transaction call itself is not a write.
   * Array-form transactions already recorded their writes when the items were built.
   * @param isTx true for the object handed to an interactive transaction callback
   */
  const makeClient = (isTx: boolean): unknown =>
    new Proxy(
      {},
      {
        get: (_t, key: string | symbol) => {
          if (typeof key !== "string") return undefined
          // Like Prisma's TransactionClient, `tx` has no `$transaction`: calling it throws.
          if (key === "$transaction" && isTx) return undefined
          if (key === "$transaction") {
            return jest.fn(async (arg: unknown) => {
              dbCalls.push("$transaction")
              return typeof arg === "function" ? (arg as (tx: unknown) => unknown)(makeClient(true)) : Array.isArray(arg) ? Promise.all(arg) : undefined
            })
          }
          if (key.startsWith("$")) {
            return jest.fn(async (...args: unknown[]) => {
              dbCalls.push(key)
              if (WRITE_METHODS.has(key)) writes.push(key)
              else if ((key === "$queryRaw" || key === "$queryRawUnsafe") && rawQueryWrites(args)) writes.push(`${key}(write)`)
              return []
            })
          }
          if (key === "then") return undefined
          return model(key)
        },
      },
    )
  return { prisma: makeClient(false), __esModule: true }
})
// External side effects must never run for real.
jest.mock("@/lib/notifications", () => new Proxy({}, { get: () => jest.fn(async () => undefined) }))
jest.mock("@/lib/stripe", () => new Proxy({ __esModule: true }, { get: (t, k) => (k in t ? (t as never)[k] : jest.fn()) }))

const ACTIONS_DIR = path.join(__dirname, "..")
const HELPERS = Object.entries(roleGuard)
  .filter(([, v]) => typeof v === "function")
  .map(([k]) => k)
  .filter((k) => k !== "canAssignRole") // two-arg helper, per-target; covered in user.ts tests
const ALL_ROLES = Object.values(UserRole) as Role[]
// The six roles named in the audit; Sunday-school roles are included via ALL_ROLES.
const AUDIT_ROLES: Role[] = ["ADMIN", "PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER"] as Role[]

type Entry = { file: string; fn: string; guards: string[] }

/** Source of a top-level function: from its start to the first column-0 closing brace. */
function bodyOf(src: string, start: number): string {
  const end = src.indexOf("\n}\n", start)
  return src.slice(start, end === -1 ? src.length : end + 2)
}

/**
 * Blank out comments and string/template literals (keeping length) so a guard-looking token inside
 * them is not mistaken for code.
 * @param src source text
 */
function stripCommentsAndStrings(src: string): string {
  const out = src.split("")
  const n = src.length
  /** Blank [from, to) with spaces, keeping newlines so offsets and line shape survive. */
  const blank = (from: number, to: number): void => {
    for (let k = from; k < Math.min(to, n); k++) if (out[k] !== "\n") out[k] = " "
  }
  const ident = /[A-Za-z0-9_$]/
  // Keywords after which a `/` starts a regex literal rather than a division.
  const REGEX_AFTER = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await"])

  /**
   * Scan template text from just after the opening backtick, blanking it. `${ ... }` holes are scanned
   * as code (recursively, so nested templates work). Returns the index after the closing backtick.
   * @param start index just after the opening backtick
   */
  const scanTemplate = (start: number): number => {
    let i = start
    while (i < n) {
      const c = src[i]
      if (c === "\\") {
        blank(i, i + 2)
        i += 2
      } else if (c === "`") {
        blank(i, i + 1)
        return i + 1
      } else if (c === "$" && src[i + 1] === "{") {
        blank(i, i + 2)
        const close = scanCode(i + 2, true)
        blank(close, close + 1)
        i = close + 1
      } else {
        blank(i, i + 1)
        i++
      }
    }
    return n
  }

  /**
   * Scan code from `start`, blanking comments, strings, templates and regex literals. When `inHole`
   * is true, stops at the `}` that closes the enclosing template hole and returns its index.
   * @param start first index to scan
   * @param inHole true when scanning a `${ }` template hole
   */
  const scanCode = (start: number, inHole: boolean): number => {
    let i = start
    let depth = 0
    let prev = ""
    let before = "" // the non-space char before `prev`, to spot postfix ++/--
    let word = ""
    while (i < n) {
      const c = src[i]
      const next = src[i + 1]
      if (c === "/" && next === "/") {
        const e = src.indexOf("\n", i)
        const end = e === -1 ? n : e
        blank(i, end)
        i = end
      } else if (c === "/" && next === "*") {
        const e = src.indexOf("*/", i + 2)
        const end = e === -1 ? n : e + 2
        blank(i, end)
        i = end
      } else if (c === '"' || c === "'") {
        let j = i + 1
        while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1
        blank(i, j + 1)
        i = j + 1
        prev = '"'
        word = ""
      } else if (c === "`") {
        blank(i, i + 1)
        i = scanTemplate(i + 1)
        prev = '"'
        word = ""
      } else if (c === "/" && (prev === "" || !(ident.test(prev) || prev === ")" || prev === "]" || prev === '"' || prev === "}") || REGEX_AFTER.has(word))) {
        let j = i + 1
        let inClass = false
        while (j < n && src[j] !== "\n" && (inClass || src[j] !== "/")) {
          if (src[j] === "\\") j++
          else if (src[j] === "[") inClass = true
          else if (src[j] === "]") inClass = false
          j++
        }
        blank(i, j + 1)
        i = j + 1
        prev = '"'
        word = ""
      } else {
        if (c === "{") depth++
        else if (c === "}") {
          if (inHole && depth === 0) return i
          depth--
        }
        if (!/\s/.test(c)) {
          word = ident.test(c) ? (ident.test(prev) ? word + c : c) : ""
          // `x++ / 2`: a postfix ++/-- ends an operand, so a following `/` is division.
          const postfix = (c === "+" || c === "-") && prev === c && (ident.test(before) || before === ")" || before === "]")
          before = prev
          prev = postfix ? ")" : c
        }
        i++
      }
    }
    return n
  }

  scanCode(0, false)
  return out.join("")
}

/**
 * True when `code` contains a call `helper(...)` whose balanced closing paren is followed by
 * `=== false` / `== false`, at any paren nesting depth.
 * @param code comment/string-stripped source
 * @param helper the roleGuard helper name
 */
function hasCallComparedToFalse(code: string, helper: string): boolean {
  for (const m of code.matchAll(new RegExp(`\\b${helper}\\(`, "g"))) {
    let depth = 1
    let i = m.index! + m[0].length
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth++
      else if (code[i] === ")") depth--
      i++
    }
    if (depth === 0 && /^\s*===?\s*false\b/.test(code.slice(i))) return true
  }
  return false
}

/**
 * Role helpers used as a refusal before the first DB access in the body: `!canX(`, `canX(...) === false`
 * and `false === canX(`. Comments and strings are ignored.
 * @param body source of one exported function
 */
function leadingGuards(body: string): string[] {
  const code = stripCommentsAndStrings(body)
  const firstDb = code.search(/\bprisma\b|\btx\./)
  const head = firstDb === -1 ? code : code.slice(0, firstDb)
  return HELPERS.filter((h) => new RegExp(`(?<!!)!\\s*${h}\\(|\\bfalse\\s*===?\\s*${h}\\(`).test(head) || hasCallComparedToFalse(head, h))
}

function discover(): Entry[] {
  const out: Entry[] = []
  for (const file of fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts")).sort()) {
    const src = fs.readFileSync(path.join(ACTIONS_DIR, file), "utf8")
    if (!src.includes("roleGuard")) continue
    for (const m of src.matchAll(/^export async function (\w+)\s*\(/gm)) {
      const body = bodyOf(src, m.index!)
      const guards = leadingGuards(body)
      if (guards.length) out.push({ file: file.replace(/\.ts$/, ""), fn: m[1], guards })
    }
  }
  return out
}

/** A value that survives any property access, call, string or number coercion. */
function anyArg(): unknown {
  const f = function () {}
  return new Proxy(f, {
    get: (_t, k) => {
      if (k === Symbol.toPrimitive) return (hint: string) => (hint === "number" ? 1 : "1")
      if (k === "then") return undefined
      if (k === Symbol.iterator) return function* () {}
      return anyArg()
    },
    apply: () => anyArg(),
  })
}

/**
 * True for the shapes guarded actions return when they refuse: an `{ error }` result, an empty
 * read (null, false, [] or {}), or the petty-cash `{ status: "not-editor" }` signal. Anything else
 * (a success flag, a populated payload, a bare undefined) is not a refusal.
 * @param r the action's resolved value
 */
function isRefusalShape(r: unknown): boolean {
  if (r === null || r === false) return true
  if (Array.isArray(r)) return r.length === 0
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>
    // A success flag beats any refusal marker: `{ success: true, error: "x" }` is not a refusal.
    if (o.success || o.ok) return false
    if (typeof o.error === "string") return true
    if (o.status === "not-editor") return true
    return Object.keys(o).length === 0
  }
  return false
}

/**
 * True when a thrown value is one of the refusal errors the next/navigation mock raises
 * (`redirect` or `notFound`), rather than an unrelated crash that happened to stop the action.
 * @param e the thrown value
 */
function isRefusalThrow(e: unknown): boolean {
  return e instanceof Error && REFUSAL_THROW.test(e.message)
}

/**
 * Fixtures for actions that return an empty read for the default junk arguments, which would make a
 * removed guard indistinguishable from a refusal. Each gives real arguments and the rows `findMany`
 * returns, so without its guard the action would hand back a non-empty result.
 */
const READ_FIXTURES: Record<string, { args: unknown[]; rows: unknown[] }> = {
  "sacrament.searchSacramentPeople": {
    args: ["smith"],
    rows: [{ id: 1, firstName: "Sam", lastName: "Smith", family: { name: "Smith" } }],
  },
}

/** An empty FormData, passed as the second argument of every action. */
function formData(): FormData {
  return new FormData()
}

const ENTRIES = discover()

/** Error messages thrown by the redirect/notFound mocks: the only throws that count as a refusal. */
const REFUSAL_THROW = /^(REDIRECT:\/(login|unauthorized|forbidden)\b|NOT_FOUND$)/

describe("role matrix: generated from src/lib/actions", () => {
  // The guarded-export set and the per-helper refused roles are pinned once, as snapshots, in the
  // "pinned discovery" block below (no second hand-kept copy to drift).

  it("leadingGuards ignores comments/strings, rejects !!canX, and accepts canX(...) === false", () => {
    expect(leadingGuards('// if (!isAdmin(r)) return\nconst s = "!isAdmin("\nawait prisma.x.create()')).toEqual([])
    expect(leadingGuards("const ok = !!isAdmin(r)\nawait prisma.x.create()")).toEqual([])
    expect(leadingGuards("if (isAdmin(session?.user?.role) === false) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("if (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
  })

  it("stripCommentsAndStrings handles regex literals, nested templates and deep call nesting", () => {
    // A backtick inside a regex literal must not open a template that swallows the guard.
    expect(leadingGuards("const r = /`/\nif (!isAdmin(x)) return\nawait prisma.x.create(`a`)")).toEqual(["isAdmin"])
    // A quote inside a regex character class, then a real guard.
    expect(leadingGuards("const r = /[\"']/g\nif (!isAdmin(x)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    // A guard-looking token inside a nested template hole's string is ignored.
    expect(leadingGuards("const s = `a ${`b ${1} !isAdmin(`} c`\nawait prisma.x.create()")).toEqual([])
    // Code inside a template hole is still code.
    expect(leadingGuards("const s = `a ${!isAdmin(r)}`\nawait prisma.x.create()")).toEqual(["isAdmin"])
    // Division is not a regex.
    expect(leadingGuards("const h = a / b\nif (!isAdmin(r)) return // x'\nawait prisma.x.create()")).toEqual(["isAdmin"])
    // Division after a postfix ++/-- is not a regex opener.
    expect(leadingGuards("let n = 4; n++ / 2; if (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("let n = 4; n-- / 2; if (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    // canX(...) === false with three or more paren levels.
    expect(leadingGuards("if (isAdmin(f(g(h(1)), (2))) === false) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("if (isAdmin(f(g(1))) === true) return\nawait prisma.x.create()")).toEqual([])
  })

  it("rawQueryWrites treats SELECT as a read and writes, locks and unknown shapes as writes", () => {
    expect(rawQueryWrites([["SELECT id FROM t WHERE a = ", ""]])).toBe(false)
    expect(rawQueryWrites(["INSERT INTO t VALUES (1)"])).toBe(true)
    expect(rawQueryWrites([["SELECT 1 FROM t FOR SHARE"]])).toBe(true)
    expect(rawQueryWrites([{ sql: "UPDATE t" }])).toBe(true)
  })

  it("isRefusalShape rejects a success flag even when an error marker is present", () => {
    expect(isRefusalShape({ error: "Unauthorized" })).toBe(true)
    expect(isRefusalShape({ success: true, error: "Unauthorized" })).toBe(false)
    expect(isRefusalShape({ ok: true, status: "not-editor" })).toBe(false)
  })

  it("every read fixture targets a discovered guarded export", () => {
    const found = new Set(ENTRIES.map((e) => `${e.file}.${e.fn}`))
    for (const k of Object.keys(READ_FIXTURES)) expect(found).toContain(k)
  })

  it("audit roles are all real UserRole values", () => {
    for (const r of AUDIT_ROLES) expect(ALL_ROLES).toContain(r)
  })

  it("OFFICE_ADMIN is refused by canAccessAccounting but allowed by canEdit (nearest-miss role)", () => {
    expect(roleGuard.canAccessAccounting("OFFICE_ADMIN" as Role)).toBe(false)
    expect(roleGuard.canEdit("OFFICE_ADMIN" as Role)).toBe(true)
  })

  // A role is only certain to be refused when EVERY guard on the export refuses it: with several
  // helpers the source may combine them with `&&` (e.g. getRegistrationDetail lets a role through
  // if either passes), and a role that one helper refuses but another allows is not refused.
  const cases = ENTRIES.flatMap((e) =>
    ALL_ROLES.filter((role) => e.guards.every((g) => !(roleGuard as unknown as Record<string, (r: Role) => boolean>)[g](role))).map(
      (role) => [`${e.file}.${e.fn} [${e.guards.join(",")}]`, e, role] as const,
    ),
  )

  it("generates refusal cases for every audit role", () => {
    const seen = new Set(cases.map(([, , r]) => r))
    for (const r of AUDIT_ROLES.filter((x) => x !== "ADMIN")) expect(seen).toContain(r)
    expect(cases.some(([, , r]) => r === "OFFICE_ADMIN")).toBe(true)
  })

  beforeEach(() => {
    writes.length = 0
    dbCalls.length = 0
    findManyRows = []
  })

  it.each(cases.map(([label, entry, role]) => [`${label} / ${role}`, entry, role] as const))("%s refuses with no DB write", async (_label, entry, role) => {
    currentRole = role
    const mod = (await import(`@/lib/actions/${entry.file}`)) as Record<string, (...a: unknown[]) => Promise<unknown>>
    let result: unknown
    let thrown: unknown
    try {
      const fixture = READ_FIXTURES[`${entry.file}.${entry.fn}`]
      if (fixture) findManyRows = fixture.rows
      result = await mod[entry.fn](...(fixture ? fixture.args : [anyArg(), formData(), anyArg()]))
    } catch (e) {
      thrown = e
    }
    expect(writes).toEqual([])
    // The guard is the first thing the action does, so a real guard refusal makes no Prisma call at
    // all, read or write. A read that ran means the refusal came from somewhere downstream.
    expect(dbCalls).toEqual([])
    // A refusal is a returned error/empty shape or a thrown redirect/not-found error. Any other
    // throw is a crash, not a refusal, and any other result is a success payload.
    if (thrown === undefined) expect(isRefusalShape(result)).toBe(true)
    else expect(isRefusalThrow(thrown)).toBe(true)
  })
})

describe("role matrix: pinned discovery (a dropped or rewritten guard must fail here)", () => {
  // Discovery only finds exports whose guard it can parse, so removing a guard silently drops the
  // export from the generated cases. Pin the discovered set, and pin which roles each helper
  // refuses, so either change shows up as a reviewed snapshot diff.
  it("pins every guarded export and its guards", () => {
    expect(Object.fromEntries(ENTRIES.map((e) => [`${e.file}.${e.fn}`, e.guards.join(",")]))).toMatchSnapshot()
  })

  it("pins the roles each one-argument roleGuard helper refuses", () => {
    const guard = roleGuard as unknown as Record<string, (r: Role) => boolean>
    const refused = Object.fromEntries(HELPERS.map((h) => [h, ALL_ROLES.filter((r) => !guard[h](r)).sort()]))
    expect(refused).toMatchSnapshot()
  })
})

describe("role matrix: pinned guards (a weakened guard must fail here)", () => {
  // Generated cases above follow whatever helper the source uses, so swapping
  // canAccessAccounting for canEdit would regenerate the expectation. Pin the
  // intended strength for the accounting mutation files.
  const ACCOUNTING = /^(transaction|receipt|reconciliation|budget|pettyCash\w*)$/
  const STRICT = new Set(["canAccessAccounting", "isAdmin"])
  it.each(ENTRIES.filter((e) => ACCOUNTING.test(e.file)).map((e) => [`${e.file}.${e.fn}`, e] as const))(
    "%s keeps an ADMIN|PASTOR guard, so OFFICE_ADMIN is refused",
    (_label, entry) => {
      expect(entry.guards.every((g) => STRICT.has(g))).toBe(true)
    },
  )
})
