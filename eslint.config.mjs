// @ts-check
import coreWebVitals from "eslint-config-next/core-web-vitals"
import { buildNoRestrictedSyntaxOptions } from "./eslint-rules/rawPalette.cjs"
import { rule as serverActionWrapperRule, allowlist as serverActionAllowlist } from "./eslint-rules/serverActionWrapper.cjs"

const eslintConfig = [
  { ignores: ["next-env.d.ts", ".next/**", "node_modules/**", "src/lib/generated/**", "website/**"] },
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
  {
    // Every exported Server Action goes through guardedAction (role guard + zod
    // argument check). Pre-wrapper actions sit on a shrink-only allowlist; see
    // eslint-rules/serverActionWrapper.cjs.
    files: ["src/lib/actions/**/*.ts"],
    ignores: ["src/lib/actions/**/__tests__/**"],
    plugins: { crm: { rules: { "server-action-wrapper": serverActionWrapperRule } } },
    rules: { "crm/server-action-wrapper": ["error", { allowlist: serverActionAllowlist }] },
  },
]

export default eslintConfig
