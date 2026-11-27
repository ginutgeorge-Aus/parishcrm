// crm/server-action-wrapper: every export of a "use server" file must be an
// async function whose only statement is `return guardedAction({ guard, args, ... }, [...], handler)`
// (src/lib/guardedAction.ts). TypeScript types vanish at runtime, so an
// exported action that skips the wrapper can receive any argument shape
// (AUD-2-01 / AUD-2-02, audit idea 83).
//
// Ratchet: exports written before the wrapper are listed in
// serverActionAllowlist.json ("<repo-relative file>:<export>"). The list may
// only shrink: __tests__/lib/eslint-server-action-wrapper-rule.test.ts fails
// on a stale entry (already wrapped or deleted), so migrating an action means
// deleting its line. A NEW action must use the wrapper; do not add it here:
// CI's `static` job fails a PR that adds any entry the base branch lacks
// (newAllowlistEntries below).
//
// CommonJS for the same reason as rawPalette.cjs: eslint.config.mjs imports it
// and Jest require()s it directly.
"use strict"

const path = require("node:path")

const WRAPPER = "guardedAction"

/**
 * True when `program` starts with a "use server" directive.
 * @param {{ body: Array<{ type: string, directive?: string }> }} program ESTree Program node
 */
function isUseServer(program) {
  for (const stmt of program.body) {
    if (stmt.type !== "ExpressionStatement" || typeof stmt.directive !== "string") return false
    if (stmt.directive === "use server") return true
  }
  return false
}

/**
 * Name of the identifier a member/call chain starts from (`z` for `z.string().max(5)`), or null.
 * @param {any} node ESTree expression
 * @returns {string | null}
 */
function chainRoot(node) {
  let n = node
  while (n) {
    if (n.type === "Identifier") return n.name
    if (n.type === "CallExpression") n = n.callee
    else if (n.type === "MemberExpression") n = n.object
    else return null
  }
  return null
}

/** Node keys that are not child nodes (ESTree `parent` would loop). */
const SKIP_KEYS = new Set(["parent", "loc", "range", "tokens", "comments"])

/**
 * The first piece of `node` that would run code when the wrapper's arguments are evaluated (before
 * the guard), described for the lint message, or null. Allowed: literals, identifiers, object/array
 * literals and zod builder chains rooted at `z` (`z.tuple([...])`, `z.string().max(9)`). Rejected:
 * any other call or `new`, `await`/`yield`, functions (only the handler may be one), assignments,
 * updates, tagged templates, and getters.
 * @param {any} node ESTree node inside the spec
 * @returns {string | null}
 */
function preGuardCode(node) {
  if (!node || typeof node.type !== "string") return null
  switch (node.type) {
    case "CallExpression":
      if (chainRoot(node) !== "z") return "a call"
      break
    case "NewExpression":
    case "AwaitExpression":
    case "YieldExpression":
    case "AssignmentExpression":
    case "UpdateExpression":
    case "TaggedTemplateExpression":
    case "ImportExpression":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "ClassExpression":
      return node.type
    case "Property":
      if (node.kind !== "init" || node.method) return "an accessor or method"
      break
  }
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === "object" && typeof child.type === "string") {
        const found = preGuardCode(child)
        if (found) return found
      }
    }
  }
  return null
}

/**
 * Why `fn` is not a correctly wrapped action, or null when it is. Correct means:
 * `async function f(a, b) { return guardedAction({ guard, args: z.tuple([A, B]), ... }, [a, b], handler) }`
 * with nothing else in the body (no code runs before the guard), one tuple entry per parameter, the
 * raw parameters passed in declaration order, and no other use of a raw parameter (so the handler
 * cannot close over an unchecked value instead of its parsed one).
 * @param {any} fn ESTree FunctionDeclaration node
 * @param {any} sourceCode ESLint SourceCode, for the parameters' scope references
 * @returns {string | null}
 */
function wrapProblem(fn, sourceCode) {
  if (!fn.async || fn.generator || !fn.body || fn.body.body.length !== 1) return "not a single-statement async function"
  const ret = fn.body.body[0]
  if (ret.type !== "ReturnStatement" || !ret.argument || ret.argument.type !== "CallExpression") return "no wrapper call"
  const call = ret.argument
  if (call.callee.type !== "Identifier" || call.callee.name !== WRAPPER) return "no wrapper call"
  if (call.arguments.length !== 3) return "wrapper needs (spec, [params], handler)"
  const [spec, input, handler] = call.arguments
  // Arguments are evaluated before guardedAction runs: the handler must be an inline function
  // (not `(await prisma.x.deleteMany(), async () => 1)` or a call that returns one), and the spec
  // may hold only literals, identifiers and zod schema builders, never other calls or awaits.
  if (handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression") {
    return "handler must be an inline async function"
  }
  if (spec.type !== "ObjectExpression") return "spec must be an object literal"
  const unsafe = preGuardCode(spec)
  if (unsafe) return `spec runs code before the guard (${unsafe})`
  const props = new Map(
    spec.properties.filter((p) => p.type === "Property" && p.key.type === "Identifier").map((p) => [p.key.name, p.value]),
  )
  if (spec.properties.some((p) => p.type !== "Property" || p.computed)) return "spec must use plain keys (no spread)"
  const guard = props.get("guard")
  if (!guard) return "spec has no guard"
  if (!(guard.type === "Identifier" || (guard.type === "Literal" && guard.value === "public"))) {
    return 'guard must be a roleGuard helper name or "public"'
  }
  const args = props.get("args")
  const isTuple =
    args &&
    args.type === "CallExpression" &&
    args.callee.type === "MemberExpression" &&
    args.callee.property.type === "Identifier" &&
    args.callee.property.name === "tuple" &&
    args.arguments[0] &&
    args.arguments[0].type === "ArrayExpression"
  if (!isTuple) return "args must be an inline z.tuple([...])"
  const entries = args.arguments[0].elements
  if (entries.some((e) => !e || e.type === "SpreadElement")) return "args tuple must list one schema per parameter"
  if (entries.length !== fn.params.length) return `args has ${entries.length} entries for ${fn.params.length} parameters`
  if (fn.params.some((p) => p.type !== "Identifier")) return "parameters must be plain identifiers"
  const names = fn.params.map((p) => p.name)
  const passesParams =
    input.type === "ArrayExpression" &&
    input.elements.length === names.length &&
    input.elements.every((e, i) => e && e.type === "Identifier" && e.name === names[i])
  if (!passesParams) return "second argument must be [every parameter, in order]"
  const [from, to] = input.range
  for (const v of sourceCode.getDeclaredVariables(fn)) {
    if (!names.includes(v.name)) continue
    if (v.references.some((r) => r.identifier.range[0] < from || r.identifier.range[1] > to)) {
      return `raw parameter '${v.name}' is used outside the wrapper input (use the handler's parsed value)`
    }
  }
  return null
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Exported Server Actions must return guardedAction(...) (role guard + zod argument check)" },
    schema: [
      {
        type: "object",
        properties: { allowlist: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      unwrapped:
        "Server Action '{{name}}' must be `return guardedAction({ guard, args: z.tuple([...]) }, [...params], handler)` " +
        "as its only statement (src/lib/guardedAction.ts): {{why}}. Unchecked arguments reach Prisma as filters (AUD-2-01).",
      notFunction:
        "Export '{{name}}': \"use server\" files may only export async function declarations that return guardedAction(...) " +
        "(src/lib/guardedAction.ts).",
    },
  },
  create(context) {
    const allow = new Set((context.options[0] && context.options[0].allowlist) || [])
    const rel = path.relative(context.cwd, context.filename).split(path.sep).join("/")
    /**
     * Report `node` unless `<file>:<name>` is allowlisted.
     * @param {import("eslint").Rule.Node} node
     * @param {string} name
     * @param {"unwrapped" | "notFunction"} messageId
     * @param {string} [why] reason, for "unwrapped"
     */
    const report = (node, name, messageId, why = "") => {
      if (!allow.has(`${rel}:${name}`)) context.report({ node, messageId, data: { name, why } })
    }
    let active = false
    return {
      Program(node) {
        active = isUseServer(node)
      },
      ExportNamedDeclaration(node) {
        if (!active || node.exportKind === "type") return
        const decl = node.declaration
        if (!decl) {
          for (const s of node.specifiers) {
            if (s.exportKind !== "type") report(s, s.exported.name ?? s.exported.value, "notFunction")
          }
          return
        }
        if (decl.type === "FunctionDeclaration") {
          const why = wrapProblem(decl, context.sourceCode)
          if (why) report(decl, decl.id.name, "unwrapped", why)
        } else if (decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) report(d, d.id.type === "Identifier" ? d.id.name : "?", "notFunction")
        } else if (decl.type === "ClassDeclaration") {
          report(decl, decl.id.name, "notFunction")
        }
        // TS type/interface declarations and overload signatures (TSDeclareFunction) are erased:
        // nothing callable. The implementation that follows an overload is checked above.
      },
      ExportAllDeclaration(node) {
        if (active && node.exportKind !== "type") report(node, "*", "notFunction")
      },
      ExportDefaultDeclaration(node) {
        if (active) report(node, "default", "notFunction")
      },
    }
  },
}

const allowlist = require("./serverActionAllowlist.json")

/**
 * Allowlist entries in `head` that `base` (the PR's base branch) did not have. The list may only
 * shrink, so CI fails on any result: a same-size swap (remove one, add a new unwrapped action)
 * passes the size ceiling but not this.
 * @param {string[]} base allowlist on the base branch
 * @param {string[]} head allowlist in this change
 * @returns {string[]}
 * Used by scripts/check-action-allowlist.mjs (CI `static` job) and the rule's Jest test.
 */
function newAllowlistEntries(base, head) {
  const before = new Set(base)
  return head.filter((e) => !before.has(e))
}

module.exports = { rule, allowlist, newAllowlistEntries }
