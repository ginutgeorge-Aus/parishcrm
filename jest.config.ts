import type { Config } from "jest"
import nextJest from "next/jest.js"

// `@react-email/render` does a runtime dynamic `import()`, which jest can only
// service with node's `--experimental-vm-modules` flag. The `npm test` scripts
// pass it via NODE_OPTIONS, but a bare `npx jest <pattern>` would miss it and
// fail those tests with "A dynamic import callback was invoked without
// --experimental-vm-modules". jest runs each test file in a forked worker that
// inherits process.env, so injecting the flag here — before the worker pool is
// spawned — makes it apply on every invocation, npm script or not. Caveat:
// `--runInBand` executes tests in this already-launched main process, so it
// still needs the flag on the CLI (use `npm test`, which passes it regardless).
if (!process.env.NODE_OPTIONS?.includes("--experimental-vm-modules")) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --experimental-vm-modules`.trim()
}

const createJestConfig = nextJest({ dir: "./" })

const config: Config = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(@react-email|react-email|html-to-text|@selderee|selderee|parseley|stripe)/)",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/.claude/",
  ],
  // Coverage is collected only when --coverage is passed (CI does; local
  // `npm test` stays fast). collectCoverageFrom spans all of src so a new
  // untested file drags the percentage down and trips the floor.
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/lib/generated/**", // generated Prisma client
    "!src/components/ui/**", // shadcn primitives — not edited here
    "!src/**/*.d.ts",
  ],
  // Floor set just under the 2026-06-23 baseline (stmts 63.2 / branches 57.8
  // / funcs 53.6 / lines 64.5). Ratchet upward as coverage improves.
  coverageThreshold: {
    global: { statements: 62, branches: 56, functions: 52, lines: 63 },
  },
  // Recycle a worker once its heap crosses this ceiling. The suite grew large
  // enough to OOM ("Ineffective mark-compacts near heap limit") the plain
  // `npm test` step on the GitHub-hosted deploy runner (less RAM than the
  // self-hosted CI runner). Bounding per-worker memory fixes it regardless of
  // suite growth, on every runner.
  workerIdleMemoryLimit: "768MB",
}

export default createJestConfig(config)
