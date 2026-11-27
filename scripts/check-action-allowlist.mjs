// CI (`static` job): the server-action allowlist may only shrink. Fails when
// eslint-rules/serverActionAllowlist.json gains any entry the base branch lacks.
// Usage: node scripts/check-action-allowlist.mjs <base-allowlist.json>
import { readFileSync } from "node:fs"
import { newAllowlistEntries, allowlist } from "../eslint-rules/serverActionWrapper.cjs"

/**
 * Compare the base branch's allowlist (path in argv) with this checkout's and exit 1 on additions.
 */
function main() {
  const basePath = process.argv[2]
  if (!basePath) {
    console.error("usage: node scripts/check-action-allowlist.mjs <base-allowlist.json>")
    process.exit(2)
  }
  const added = newAllowlistEntries(JSON.parse(readFileSync(basePath, "utf8")), allowlist)
  if (added.length) {
    console.error(`New server actions must use guardedAction; these allowlist entries are new:\n${added.join("\n")}`)
    process.exit(1)
  }
  console.log(`Server-action allowlist: ${allowlist.length} entries, none added.`)
}

main()
