#!/usr/bin/env node
// Supply-chain license gate. Dependency-free: parses the built-in
// `npm sbom` CycloneDX output (no third-party license tool to trust) and fails
// if any dependency carries a license incompatible with shipping this app.
//
// Policy for a privately-hosted (SaaS-delivered) church app:
//   - HARD FAIL: network/strong copyleft — AGPL, SSPL, and plain GPL. AGPL/SSPL
//     reach across the network boundary; GPL is flagged conservatively because
//     the app ships as a Docker image.
//   - ALLOWED: LGPL (weak copyleft, dynamically-linked native libs such as
//     sharp's libvips), and all permissive licenses (MIT/ISC/BSD/Apache/…).
//   - The root package (our own, marked UNLICENSED/private) is skipped.
//
// Run: node scripts/check-licenses.mjs   (reads $SBOM_FILE if set, else runs npm sbom)

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

// Dependencies that ship no `license` field in their package.json but are known
// permissive upstream. Listing them here documents the accepted license instead
// of leaving them as a silent "(none)" in the summary. Any (none) dependency NOT
// on this list is surfaced as a warning so new ones get reviewed.
const MISSING_LICENSE_ALLOWLIST = {
  "png-js": "MIT", // via pdfkit — MIT upstream (github.com/devongovett/png.js), no license field published
  "seq-queue": "MIT", // via prisma → mysql2 — MIT upstream (github.com/changchang/seq-queue), no license field published
}

function loadSbom() {
  if (process.env.SBOM_FILE) return JSON.parse(readFileSync(process.env.SBOM_FILE, "utf8"))
  const out = execFileSync("npm", ["sbom", "--sbom-format", "cyclonedx"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return JSON.parse(out)
}

// Pull every license string off a CycloneDX component (id | name | expression).
function licensesOf(component) {
  const out = []
  for (const entry of component.licenses ?? []) {
    if (entry.license?.id) out.push(entry.license.id)
    else if (entry.license?.name) out.push(entry.license.name)
    else if (entry.expression) out.push(entry.expression)
  }
  return out
}

// True when a license string is a hard-fail. Substring-based so it catches the
// `-only` / `-or-later` SPDX suffix variants. LGPL contains "GPL", so it must be
// excluded before the GPL check.
function isDenied(licRaw) {
  const l = licRaw.toUpperCase()
  if (l.includes("LGPL")) return false
  if (l.includes("AGPL")) return true
  if (l.includes("SSPL")) return true
  if (l.includes("BUSL") || l.includes("BUSINESS SOURCE")) return true
  if (l.includes("CC-BY-NC") || l.includes("-NC-") || l.endsWith("-NC")) return true // non-commercial
  if (/\bGPL\b/.test(l) || l.includes("GPL-")) return true
  return false
}

const sbom = loadSbom()
const rootRef = sbom.metadata?.component?.["bom-ref"]
const rootName = sbom.metadata?.component?.name
const components = sbom.components ?? []

const summary = new Map()
const offenders = []
const undocumentedMissing = []
for (const c of components) {
  if (c["bom-ref"] === rootRef || c.name === rootName) continue // skip our own package
  let lics = licensesOf(c)
  if (lics.length === 0) {
    const allowed = MISSING_LICENSE_ALLOWLIST[c.name]
    if (allowed) {
      lics = [allowed] // count under the documented license, still run the policy check below
    } else {
      summary.set("(none)", (summary.get("(none)") ?? 0) + 1)
      undocumentedMissing.push(`${c.name}@${c.version}`)
    }
  }
  for (const lic of lics) {
    summary.set(lic, (summary.get(lic) ?? 0) + 1)
    if (isDenied(lic)) offenders.push(`${c.name}@${c.version}  —  ${lic}`)
  }
}

// Print a compact license summary, most-common first.
const sorted = [...summary.entries()].sort((a, b) => b[1] - a[1])
console.log(`License summary (${components.length - 1} dependencies):`)
for (const [lic, n] of sorted) console.log(`  ${String(n).padStart(4)}  ${lic}`)

// Surface any dependency with no license metadata that isn't documented in the
// allowlist — not a policy failure, but it should be reviewed and either
// allowlisted with a rationale or replaced.
if (undocumentedMissing.length > 0) {
  console.warn(`\n⚠ ${undocumentedMissing.length} dependency(ies) carry no license metadata and are not allowlisted:`)
  for (const m of undocumentedMissing) console.warn(`  ${m}`)
  console.warn("Confirm each is permissive upstream, then add it to MISSING_LICENSE_ALLOWLIST in scripts/check-licenses.mjs.")
}

if (offenders.length > 0) {
  console.error(`\n✗ ${offenders.length} dependency license(s) violate policy (AGPL/SSPL/GPL/non-commercial):`)
  for (const o of offenders) console.error(`  ${o}`)
  console.error("\nReplace the dependency, or if intentionally acceptable, adjust the policy in scripts/check-licenses.mjs with a rationale.")
  process.exit(1)
}
console.log("\n✓ No disallowed dependency licenses.")
