import type { KnipConfig } from "knip"

const config: KnipConfig = {
  // Ops scripts are entry points in their own right. Without this, a script's
  // imports only count when a workflow YAML happens to reference it (knip's
  // GitHub Actions plugin) — the OSS snapshot drops private workflows, so
  // exports used only by scripts (e.g. MAINTENANCE_KEY) would read as unused.
  entry: ["scripts/**/*.{ts,mjs}"],
  // Next.js plugin auto-discovers pages, API routes, and middleware
  ignoreDependencies: [
    // Used as serverExternalPackages — loaded at runtime, not imported directly
    "pdfjs-dist", // unpdf peer, bundled via outputFileTracingIncludes
    // CSS / tooling — not JS imports
    "tw-animate-css",
    // Imported by postcss.config.mjs; peer of the PostCSS toolchain, not a direct app dep.
    "postcss-load-config",
    // CLI tools that appear in package.json but aren't imported
    "shadcn",
    // Type packages that provide ambient types, not explicit imports
    "@types/bcryptjs",
    // Script runner used for one-off scripts
    "ts-node",
    // Type-only import in telemetry-redact.ts; resolved transitively via the
    // installed @opentelemetry stack, not a direct runtime dependency.
    "@opentelemetry/sdk-trace-base",
    // Runtime dep of the Prisma-generated client (src/lib/generated/prisma,
    // gitignored so knip never scans it) — not imported by app code directly.
    "@prisma/client",
  ],
  ignore: [
    // shadcn/ui generated components — intentional re-export surface, not consumed internally
    "src/components/ui/**",
    // One-off operational scripts — not part of the app build graph
    "scripts/**",
    // Claude Code local tooling (hooks, settings) — not part of the app build graph.
    ".claude/**",
  ],
}

export default config
