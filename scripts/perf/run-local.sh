#!/usr/bin/env bash
# Perf-baseline local run. Seeds a realistic-volume local dev DB, builds, and starts
# the app with query logging on. Handles the two gotchas the raw recipe hits:
#   1. ENCRYPTION_KEY lives in .env.local (scripts only auto-load .env) — sourced below.
#   2. next start forces NODE_ENV=production, so the boot guard rejects DISABLE_OTP unless
#      E2E_ALLOW_TEST_OVERRIDES=true rides along (guard still blocks it against a real prod AUTH_URL).
# Run from repo root:  scripts/perf/run-local.sh
# Leaves the server running; open a new shell for measure.ts / analyze-queries.ts.
set -euo pipefail

if [[ ! -f .env.local ]]; then
  echo "error: .env.local not found — run from repo root; ENCRYPTION_KEY must be set there" >&2
  exit 1
fi
set -a; . ./.env.local; set +a   # export ENCRYPTION_KEY etc.

echo "==> seeding base data"
ALLOW_DEMO_SEED=true npm run db:seed   # local perf DB only — demo passwords are public
echo "==> seeding realistic volume (500 fam / ~2k people / 30k txn / 50k audit / 5k regs)"
npx tsx scripts/perf/seed-volume.ts

echo "==> building"
npm run build

mkdir -p scratchpad/perf
echo "==> starting server with query logging (Ctrl+\\ to stop); run measure.ts in a new shell"
PERF_QUERY_LOG=1 PERF_QUERY_LOG_FILE="$PWD/scratchpad/perf/queries.jsonl" \
  DISABLE_OTP=true E2E_ALLOW_TEST_OVERRIDES=true npm run start
