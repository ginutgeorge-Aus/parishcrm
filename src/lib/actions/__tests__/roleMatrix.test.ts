/**
 * @jest-environment node
 *
 * AUD-7-07 role matrix. GENERATED from source: scans every src/lib/actions/*.ts,
 * finds each exported async function that opens with a negated roleGuard check
 * (`if (!canX(session?.user?.role)) ...` before any DB access), and for every
 * role that the REAL roleGuard helpers refuse, asserts the action performs no
 * Prisma write. Covers OFFICE_ADMIN being refused on admin-only / PASTOR+ADMIN
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
  "$transaction",
])
const writes: string[] = []
let currentRole: Role | undefined

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
            if (WRITE_METHODS.has(method)) writes.push(`${name}.${method}`)
            return method.startsWith("find") ? (method === "findMany" ? [] : null) : method === "count" ? 0 : undefined
          }),
      },
    )
  const client: unknown = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "$transaction") {
          return jest.fn(async () => {
            writes.push("$transaction")
            return undefined
          })
        }
        if (key.startsWith("$")) {
          return jest.fn(async () => {
            if (WRITE_METHODS.has(key)) writes.push(key)
            return []
          })
        }
        if (key === "then") return undefined
        return model(key)
      },
    },
  )
  return { prisma: client, __esModule: true }
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

/** Negated role helpers that appear before the first DB access in the body. */
function leadingGuards(body: string): string[] {
  const firstDb = body.search(/\bprisma\b|\btx\./)
  const head = firstDb === -1 ? body : body.slice(0, firstDb)
  return HELPERS.filter((h) => new RegExp(`!\\s*${h}\\(`).test(head))
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

function formData(): FormData {
  return new FormData()
}

const ENTRIES = discover()

describe("role matrix: generated from src/lib/actions", () => {
  it("discovers a meaningful number of guarded actions", () => {
    expect(ENTRIES.length).toBeGreaterThan(80)
  })

  it("covers the audit's accounting files", () => {
    const files = new Set(ENTRIES.map((e) => e.file))
    for (const f of ["transaction", "receipt", "reconciliation", "budget"]) expect(files).toContain(f)
  })

  it("audit roles are all real UserRole values", () => {
    for (const r of AUDIT_ROLES) expect(ALL_ROLES).toContain(r)
  })

  it("OFFICE_ADMIN is refused by canAccessAccounting but allowed by canEdit (nearest-miss role)", () => {
    expect(roleGuard.canAccessAccounting("OFFICE_ADMIN" as Role)).toBe(false)
    expect(roleGuard.canEdit("OFFICE_ADMIN" as Role)).toBe(true)
  })

  const cases = ENTRIES.flatMap((e) =>
    ALL_ROLES.filter((role) => e.guards.every((g) => !(roleGuard as Record<string, (r: Role) => boolean>)[g](role))).map(
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
  })

  it.each(cases)("%s refuses %s with no DB write", async (_label, entry, role) => {
    currentRole = role
    const mod = (await import(`@/lib/actions/${entry.file}`)) as Record<string, (...a: unknown[]) => Promise<unknown>>
    let result: unknown
    let thrown: unknown
    try {
      result = await mod[entry.fn](anyArg(), formData(), anyArg())
    } catch (e) {
      thrown = e
    }
    expect(writes).toEqual([])
    // A refusal is a returned error/forbidden shape or a thrown auth/redirect error,
    // never a success payload.
    if (thrown === undefined && result && typeof result === "object") {
      const r = result as Record<string, unknown>
      expect(r.success === true || r.ok === true).toBe(false)
    }
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
