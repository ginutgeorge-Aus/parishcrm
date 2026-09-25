// Shared boilerplate for the one-off ops/backfill scripts in scripts/.
// These scripts all parse the same --apply / --yes flags, default to a dry run,
// print the target DB host, and refuse to write unless BOTH flags are passed.
// Extracting it here keeps the guard semantics identical across every script.

/** Default page size for batched backfills. */
export const DEFAULT_BATCH_SIZE = 100

export interface ScriptArgs {
  /** True when `--apply` was passed — otherwise the script runs as a dry run. */
  apply: boolean
  /** True when `--yes` was passed — confirms the target host before writing. */
  confirmed: boolean
  /** Page size for batched backfills (always DEFAULT_BATCH_SIZE today). */
  batchSize: number
}

/**
 * Parse the standard ops-script flags from `process.argv`, matching the exact
 * behaviour the scripts previously inlined: `--apply` enables writes, `--yes`
 * confirms the target. `batchSize` is fixed at DEFAULT_BATCH_SIZE.
 */
export function parseScriptArgs(): ScriptArgs {
  return {
    apply: process.argv.includes("--apply"),
    confirmed: process.argv.includes("--yes"),
    batchSize: DEFAULT_BATCH_SIZE,
  }
}

/** Host portion of a DB connection string, or a safe placeholder if unparseable. */
export function dbHost(url: string | undefined): string {
  try {
    return new URL(url!).host
  } catch {
    return "(unparseable DATABASE_URL)"
  }
}

/**
 * Enforce the dry-run-by-default guard: if `--apply` was passed without `--yes`,
 * print the refusal message, disconnect Prisma, and exit(1). No-op otherwise.
 *
 * The default message matches the wording the encrypt/set-default backfill
 * scripts used; `backfill-petty-cash-sundays` passes its own (slightly shorter)
 * text to preserve its exact user-visible output.
 */
export async function requireConfirmation(
  apply: boolean,
  confirmed: boolean,
  disconnect: () => Promise<unknown>,
  message = "Refusing to --apply without --yes. Verify the target host above is correct, then re-run with --apply --yes.",
): Promise<void> {
  if (apply && !confirmed) {
    console.error(message)
    await disconnect()
    process.exit(1)
  }
}
