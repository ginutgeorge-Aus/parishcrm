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
// deleting its line. A NEW action must use the wrapper; do not add it here.
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
  const [spec, input] = call.arguments
  if (spec.type !== "ObjectExpression") return "spec must be an object literal"
  const props = new Map(
    spec.properties.filter((p) => p.type === "Property" && p.key.type === "Identifier").map((p) => [p.key.name, p.value]),
  )
  if (!props.has("guard")) return "spec has no guard"
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

module.exports = { rule, allowlist }
