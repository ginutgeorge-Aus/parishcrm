/** @jest-environment node */
// Verifies the custom no-restricted-syntax guard added in eslint.config.mjs
// actually catches raw Tailwind palette classNames and leaves
// semantic-token classNames alone. Builds the rule options from the same
// eslint-rules/rawPalette.cjs module eslint.config.mjs consumes, so this
// test breaks if the real rule's pattern/selectors drift, instead of testing
// a hand-copied regex. Plain require() (not dynamic import of the .mjs
// config) because this repo's Node version doesn't support Jest's
// require(ESM) synchronous interop.
import { Linter } from "eslint"
const rawPalette = require("../../eslint-rules/rawPalette.cjs")

function lint(ruleOptions: unknown, code: string) {
  const linter = new Linter()
  return linter.verify(
    code,
    [
      {
        // Flat config: a config with no `files` never matches any filename,
        // even for a single-entry array — Linter#verify just reports "No
        // matching configuration found" instead of applying it globally.
        files: ["**/*.jsx"],
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: { "no-restricted-syntax": ruleOptions as never },
      },
    ],
    { filename: "fixture.jsx" }
  )
}

describe("no-restricted-syntax raw-palette guard", () => {
  const ruleOptions = rawPalette.buildNoRestrictedSyntaxOptions("error")

  it("flags a raw Tailwind palette color in a plain className string", () => {
    const messages = lint(ruleOptions, `const X = () => <div className="text-slate-500">hi</div>`)
    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("flags bare bg-white", () => {
    const messages = lint(ruleOptions, `const X = () => <div className="bg-white">hi</div>`)
    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("does NOT flag bg-white/NN opacity overlays (intentional pattern, e.g. Sidebar hover states)", () => {
    const messages = lint(ruleOptions, `const X = () => <div className="hover:bg-white/10">hi</div>`)
    expect(messages).toHaveLength(0)
  })

  it("flags a raw palette color nested inside a className template literal", () => {
    const messages = lint(
      ruleOptions,
      "const X = (ok) => <div className={`text-sm ${ok ? \"text-green-600\" : \"text-red-600\"}`}>hi</div>"
    )
    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("flags a raw palette color in a static (no-substitution) template literal className", () => {
    const messages = lint(ruleOptions, "const X = () => <div className={`rounded-lg border-gray-200 p-4`}>hi</div>")
    expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true)
  })

  it("does NOT flag semantic-token classNames", () => {
    const messages = lint(
      ruleOptions,
      `const X = () => <div className="bg-card border-border text-muted-foreground text-income text-expense text-destructive bg-muted text-foreground">hi</div>`
    )
    expect(messages).toHaveLength(0)
  })

  it("does NOT flag a raw palette class on a non-className attribute", () => {
    const messages = lint(ruleOptions, `const X = () => <div data-color="text-red-500">hi</div>`)
    expect(messages).toHaveLength(0)
  })
})
