// @ts-check
import coreWebVitals from "eslint-config-next/core-web-vitals"
import { buildNoRestrictedSyntaxOptions } from "./eslint-rules/rawPalette.cjs"

const eslintConfig = [
  { ignores: ["next-env.d.ts", ".next/**", "node_modules/**", "src/lib/generated/**"] },
  ...coreWebVitals,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      // "warn" (not "error"): ~70 pre-existing amber/warning + green-success-message
      // classNames are intentionally deferred until lands the --warning/--success
      // tokens. `npm run lint` doesn't pass --max-warnings, so this doesn't
      // fail CI today; it still surfaces in `eslint .` output for new violations.
      // Rule + fixture regex live in eslint-rules/rawPalette.cjs so the lint rule and
      // its test (__tests__/lib/eslint-raw-palette-rule.test.ts) can't drift apart.
      "no-restricted-syntax": buildNoRestrictedSyntaxOptions("warn"),
    },
  },
]

export default eslintConfig
