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
 * True when `fn` is `async function f(...) { return guardedAction({ guard: ..., args: ... }, ...) }`
 * with nothing else in the body, so no code runs before the guard and the argument parse.
 * @param {any} fn ESTree FunctionDeclaration node
 */
function isWrapped(fn) {
  if (!fn.async || !fn.body || fn.body.body.length !== 1) return false
  const ret = fn.body.body[0]
  if (ret.type !== "ReturnStatement" || !ret.argument || ret.argument.type !== "CallExpression") return false
  const call = ret.argument
  if (call.callee.type !== "Identifier" || call.callee.name !== WRAPPER) return false
  const spec = call.arguments[0]
  if (!spec || spec.type !== "ObjectExpression") return false
  const keys = new Set(
    spec.properties.filter((p) => p.type === "Property" && p.key.type === "Identifier").map((p) => p.key.name),
  )
  return keys.has("guard") && keys.has("args") && call.arguments.length === 3
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
        "Server Action '{{name}}' must be `return guardedAction({ guard, args }, [...params], handler)` as its only " +
        "statement (src/lib/guardedAction.ts). Unchecked arguments reach Prisma as filters (AUD-2-01).",
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
     */
    const report = (node, name, messageId) => {
      if (!allow.has(`${rel}:${name}`)) context.report({ node, messageId, data: { name } })
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
          for (const s of node.specifiers) if (s.exportKind !== "type") report(s, s.exported.name, "notFunction")
          return
        }
        if (decl.type === "FunctionDeclaration") {
          if (!isWrapped(decl)) report(decl, decl.id.name, "unwrapped")
        } else if (decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) report(d, d.id.type === "Identifier" ? d.id.name : "?", "notFunction")
        }
        // TS type/interface declarations are erased: nothing callable.
      },
      ExportDefaultDeclaration(node) {
        if (active) report(node, "default", "notFunction")
      },
    }
  },
}

const allowlist = require("./serverActionAllowlist.json")

module.exports = { rule, allowlist }
