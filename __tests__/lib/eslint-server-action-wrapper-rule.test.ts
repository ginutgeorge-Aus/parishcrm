/** @jest-environment node */
// crm/server-action-wrapper (eslint-rules/serverActionWrapper.cjs): fixtures
// for what it flags, plus the ratchet over src/lib/actions. The allowlist of
// pre-wrapper actions must equal exactly what the rule finds unwrapped, so a
// migrated (or deleted) action has to leave the list, and the list has a
// ceiling that may only go down. Uses the same module eslint.config.mjs loads.
import fs from "node:fs"
import path from "node:path"
import { Linter } from "eslint"
const { rule, allowlist, newAllowlistEntries } = require("../../eslint-rules/serverActionWrapper.cjs") as {
  rule: import("eslint").Rule.RuleModule
  allowlist: string[]
  newAllowlistEntries: (base: string[], head: string[]) => string[]
}
// The TypeScript parser eslint-config-next configures for `npm run lint`, resolved through it so
// this test parses with the very same version.
const tsParser = require(require.resolve("@typescript-eslint/parser", { paths: [require.resolve("eslint-config-next")] }))

/**
 * Ceiling for the allowlist size. Lower it in the PR that migrates actions; never raise it:
 * a new Server Action must use guardedAction instead of joining the list.
 */
const MAX_ALLOWLIST = 274

const ROOT = process.cwd()
const ACTIONS_DIR = "src/lib/actions"

/**
 * Run only crm/server-action-wrapper over `code` as if it lived at `file`.
 * @param code source text
 * @param file repo-relative path the rule sees
 * @param allow allowlist entries
 * @returns the names the rule reported, in order
 */
function lint(code: string, file = `${ACTIONS_DIR}/fixture.ts`, allow: string[] = []): string[] {
  const linter = new Linter({ cwd: ROOT })
  const msgs = linter.verify(
    code,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tsParser },
        plugins: { crm: { rules: { "server-action-wrapper": rule } } },
        rules: { "crm/server-action-wrapper": ["error", { allowlist: allow }] },
      },
    ],
    { filename: path.join(ROOT, file) },
  )
  const fatal = msgs.filter((m) => m.ruleId !== "crm/server-action-wrapper")
  if (fatal.length) throw new Error(fatal.map((m) => m.message).join("\n"))
  return msgs.map((m) => /'(\w+)'/.exec(m.message)?.[1] ?? "<export>")
}

const WRAPPED = `"use server"
export async function ok(id: number): Promise<{ error: string } | undefined> {
  return guardedAction({ guard: isAdmin, args: z.tuple([pgIdArg]) }, [id], async (_c, [id]) => undefined)
}
`

describe("crm/server-action-wrapper fixtures", () => {
  it("accepts an export whose only statement returns guardedAction", () => {
    expect(lint(WRAPPED)).toEqual([])
  })

  it("flags an export that checks the role by hand", () => {
    expect(lint(`"use server"\nexport async function bad(id: number) {\n  const s = await auth()\n  if (!isAdmin(s?.user?.role)) return { error: "Unauthorized" }\n}\n`)).toEqual(["bad"])
  })

  it("flags code before the wrapper (it would run unguarded)", () => {
    expect(lint(`"use server"\nexport async function early(id: number) {\n  await prisma.x.delete({ where: { id } })\n  return guardedAction({ guard: isAdmin, args: z.tuple([]) }, [], async () => undefined)\n}\n`)).toEqual(["early"])
  })

  it("flags a wrapper call missing its guard or args, or its handler", () => {
    expect(lint(`"use server"\nexport async function noArgs() {\n  return guardedAction({ guard: isAdmin }, [], async () => 1)\n}\n`)).toEqual(["noArgs"])
    expect(lint(`"use server"\nexport async function noGuard() {\n  return guardedAction({ args: z.tuple([]) }, [], async () => 1)\n}\n`)).toEqual(["noGuard"])
    expect(lint(`"use server"\nexport async function noHandler() {\n  return guardedAction({ guard: isAdmin, args: z.tuple([]) }, [])\n}\n`)).toEqual(["noHandler"])
  })

  it("flags a wrapper that does not check every raw parameter (AUD-2-01 bypass shapes)", () => {
    const fn = (sig: string, tuple: string, input: string, handler: string) =>
      `"use server"\nexport async function f(${sig}) {\n  return guardedAction({ guard: isAdmin, args: z.tuple([${tuple}]) }, [${input}], ${handler})\n}\n`
    // Empty tuple + handler closing over the raw, unchecked id.
    expect(lint(fn("id: number", "", "", "async () => prisma.x.delete({ where: { id } })"))).toEqual(["f"])
    // Tuple lists the param, but the handler still reads the raw outer value.
    expect(lint(fn("id: number", "pgIdArg", "id", "async () => prisma.x.delete({ where: { id } })"))).toEqual(["f"])
    // Fewer schemas than parameters.
    expect(lint(fn("a: number, b: string", "pgIdArg", "a, b", "async (_c, [a]) => a"))).toEqual(["f"])
    // Parameters passed out of order, or one missing.
    expect(lint(fn("a: number, b: number", "pgIdArg, pgIdArg", "b, a", "async (_c, [a, b]) => a + b"))).toEqual(["f"])
    expect(lint(fn("a: number, b: number", "pgIdArg, pgIdArg", "a", "async (_c, [a]) => a"))).toEqual(["f"])
    // args not an inline tuple.
    expect(lint(`"use server"\nexport async function f(id: number) {\n  return guardedAction({ guard: isAdmin, args: Schema }, [id], async (_c, [id]) => id)\n}\n`)).toEqual(["f"])
    // Destructured or defaulted parameters cannot be passed through unchanged.
    expect(lint(fn("{ id }: { id: number }", "pgIdArg", "id", "async (_c, [id]) => id"))).toEqual(["f"])
    // Correct: every parameter, in order, handler uses only its parsed values (optional param ok).
    expect(lint(fn("a: number, b?: { x?: boolean }", "pgIdArg, Opts", "a, b", "async (_c, [a, b]) => [a, b]"))).toEqual([])
  })

  it("flags code that runs before the guard while the wrapper's arguments are evaluated", () => {
    const fn = (spec: string, handler = "async () => 1") =>
      `"use server"\nexport async function f() {\n  return guardedAction(${spec}, [], ${handler})\n}\n`
    const ok = "{ guard: isAdmin, args: z.tuple([]) }"
    // Handler position: a sequence that deletes first, a call returning a handler, a handler variable.
    expect(lint(fn(ok, "(await prisma.fund.deleteMany(), async () => undefined)"))).toEqual(["f"])
    expect(lint(fn(ok, "makeHandler()"))).toEqual(["f"])
    expect(lint(fn(ok, "handler"))).toEqual(["f"])
    // Spec: non-zod calls, awaits, computed guards, spreads, getters.
    expect(lint(fn("{ guard: isAdmin, args: z.tuple([]), denied: prisma.fund.deleteMany() }"))).toEqual(["f"])
    expect(lint(fn("{ guard: isAdmin, args: z.tuple([]), feature: await x }"))).toEqual(["f"])
    expect(lint(fn("{ guard: (wipe(), isAdmin), args: z.tuple([]) }"))).toEqual(["f"])
    expect(lint(fn("{ guard: pick(isAdmin), args: z.tuple([]) }"))).toEqual(["f"])
    expect(lint(fn("{ ...base, guard: isAdmin, args: z.tuple([]) }"))).toEqual(["f"])
    expect(lint(fn("{ guard: isAdmin, args: z.tuple([]), get denied() { return wipe() } }"))).toEqual(["f"])
    expect(lint(fn("{ guard: isAdmin, args: z.tuple([z.string().max(prisma.x.count())]) }"))).toEqual(["f"])
    // Allowed: literals, identifiers, arrays and zod builder chains; "public" guard; function handler.
    expect(lint(fn('{ guard: "public", args: z.tuple([]), feature: "events", denied: [], blockInDemo: true }'))).toEqual([])
    expect(lint(fn(ok, "async function () { return 1 }"))).toEqual([])
  })

  it("flags generators, classes and export-all in a 'use server' file", () => {
    expect(lint(`"use server"\nexport async function* g() { return guardedAction({ guard: isAdmin, args: z.tuple([]) }, [], async () => 1) }\n`)).toEqual(["g"])
    expect(lint(`"use server"\nexport class C {}\n`)).toEqual(["C"])
    expect(lint(`"use server"\nexport * from "./other"\n`)).toEqual(["<export>"])
  })

  it("flags exported consts, re-exports and default exports", () => {
    expect(lint(`"use server"\nexport const a = async () => 1\nconst b = async () => 2\nexport { b }\nexport default async function () {}\n`))
      .toEqual(["a", "b", "default"])
  })

  it("ignores type-only exports and files without a 'use server' directive", () => {
    expect(lint(`"use server"\nexport type T = { a: 1 }\nexport interface I { a: 1 }\n`)).toEqual([])
    expect(lint(`export async function helper() { return 1 }\n`, "src/lib/actions/types.ts")).toEqual([])
  })

  it("finds the directive after another directive", () => {
    expect(lint(`"use strict"\n"use server"\nexport async function x() { return 1 }\n`)).toEqual(["x"])
  })

  it("skips allowlisted exports only for their own file", () => {
    const code = `"use server"\nexport async function legacy() { return 1 }\n`
    expect(lint(code, `${ACTIONS_DIR}/a.ts`, [`${ACTIONS_DIR}/a.ts:legacy`])).toEqual([])
    expect(lint(code, `${ACTIONS_DIR}/b.ts`, [`${ACTIONS_DIR}/a.ts:legacy`])).toEqual(["legacy"])
  })
})

describe("crm/server-action-wrapper ratchet over src/lib/actions", () => {
  /** Every unwrapped export the rule finds with an empty allowlist, as `file:name`. */
  const unwrapped = fs
    .readdirSync(path.join(ROOT, ACTIONS_DIR))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .flatMap((f) => {
      const file = `${ACTIONS_DIR}/${f}`
      return lint(fs.readFileSync(path.join(ROOT, file), "utf8"), file).map((name) => `${file}:${name}`)
    })

  it("the allowlist is exactly the unwrapped exports (delete a line when you migrate an action)", () => {
    // Extra entries here = stale (already wrapped or deleted): remove them and lower MAX_ALLOWLIST.
    // Missing entries = a new unwrapped action: wrap it in guardedAction instead.
    expect([...allowlist].sort()).toEqual([...unwrapped].sort())
  })

  it("the allowlist has no duplicates and never grows past its ceiling", () => {
    expect(new Set(allowlist).size).toBe(allowlist.length)
    expect(allowlist.length).toBeLessThanOrEqual(MAX_ALLOWLIST)
  })

  it("newAllowlistEntries (CI shrink check) flags additions, including a same-size swap", () => {
    expect(newAllowlistEntries(["a:x", "a:y"], ["a:x"])).toEqual([])
    expect(newAllowlistEntries(["a:x", "a:y"], ["a:x", "b:new"])).toEqual(["b:new"])
    expect(newAllowlistEntries(["a:x"], ["a:x", "a:x2"])).toEqual(["a:x2"])
  })

  it("migrated files are off the list (fund.ts is fully wrapped)", () => {
    expect(allowlist.filter((e) => e.startsWith(`${ACTIONS_DIR}/fund.ts:`))).toEqual([])
  })
})
