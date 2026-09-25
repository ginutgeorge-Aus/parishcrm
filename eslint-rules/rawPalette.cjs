// Shared between eslint.config.mjs (consumed as the live lint rule) and
// __tests__/lib/eslint-raw-palette-rule.test.ts (consumed to verify the rule
// actually catches/misses what it should) so the two never drift apart.
// CommonJS on purpose: eslint.config.mjs (ESM) can `import` a .cjs module's
// default export fine, and Jest can `require()` it directly without needing
// Node's synchronous ESM interop (which this repo's sandbox Node doesn't have).
"use strict"

// Raw Tailwind palette color in a className: (text|bg|border|ring)-<gray-family>-<shade>,
// or bare bg-white / text-black. Excludes bg-white/NN (opacity overlays, e.g. hover
// overlays on colored surfaces like the sidebar) which are a legitimate, intentional
// pattern distinct from "this is a plain white card".
const RAW_PALETTE_PATTERN =
  "\\b(?:text|bg|border|ring)-(?:slate|gray|zinc|neutral|red|green|blue|amber|emerald|rose)-[0-9]|\\bbg-white(?!\\/)|\\btext-black\\b"

const RAW_PALETTE_MESSAGE =
  "Raw Tailwind palette color in className — use a semantic token instead " +
  "(bg-card, border-border, text-muted-foreground, text-income/text-expense, text-destructive, " +
  "bg-muted, text-foreground, etc.)."

function buildNoRestrictedSyntaxOptions(severity) {
  return [
    severity,
    {
      selector: `JSXAttribute[name.name='className'] Literal[value=/${RAW_PALETTE_PATTERN}/]`,
      message: RAW_PALETTE_MESSAGE,
    },
    {
      selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${RAW_PALETTE_PATTERN}/]`,
      message: RAW_PALETTE_MESSAGE,
    },
  ]
}

module.exports = { buildNoRestrictedSyntaxOptions }
