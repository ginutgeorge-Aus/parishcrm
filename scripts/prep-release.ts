// Mechanical release prep — the toil-killer half of the release-helper.
//
//   npx tsx scripts/prep-release.ts v1.22.0 --highlights "Bullet one|Bullet two"
//   npx tsx scripts/prep-release.ts v1.22.0 --highlights "..." --write
//
// Does the three edits that are error-prone to do by hand every release:
//   1. CHANGELOG.md   — rename [Unreleased] → [version] - date, insert fresh
//                       empty [Unreleased] skeleton above it
//   2. whatsNew.ts    — prepend a new entry (version + date + highlights)
//   3. whatsNew.test.ts — bump the hard-coded WHATS_NEW[0].version assertion
//
// Dry-run by default (prints the planned edits); pass --write to apply. The
// GitHub Actions release workflow calls this with --write, then commits + tags.
// It does NOT decide the version, write the highlight bullets, or deploy — those
// stay human / the tag-triggered deploy.yml.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Run from repo root (npx tsx scripts/prep-release.ts …), matching sibling scripts.
const ROOT = process.cwd()
const CHANGELOG = join(ROOT, "CHANGELOG.md")
const WHATS_NEW = join(ROOT, "src/lib/whatsNew.ts")
const WHATS_NEW_TEST = join(ROOT, "__tests__/lib/whatsNew.test.ts")

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2)
const version = argv.find((a) => !a.startsWith("--"))
const write = argv.includes("--write")
const dateArg = argv[argv.indexOf("--date") + 1]
const highlightsArg = argv[argv.indexOf("--highlights") + 1]

if (!version) fail("usage: prep-release.ts <version> --highlights \"a|b\" [--date YYYY-MM-DD] [--write]")
if (!/^v\d+\.\d+\.\d+$/.test(version)) fail(`version must match v0.0.0, got "${version}"`)

if (argv.indexOf("--date") === -1 || !dateArg) fail("--date YYYY-MM-DD is required (Date.* is nondeterministic — pass it explicitly)")
const date = dateArg
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be YYYY-MM-DD, got "${date}"`)

if (argv.indexOf("--highlights") === -1 || !highlightsArg) fail("--highlights \"Bullet one|Bullet two\" is required")
const highlights = highlightsArg.split("|").map((h) => h.trim()).filter(Boolean)
if (highlights.length === 0) fail("--highlights produced no non-empty bullets")

// ---- 1. CHANGELOG --------------------------------------------------------
const changelog = readFileSync(CHANGELOG, "utf8")
if (changelog.includes(`## [${version}]`)) fail(`CHANGELOG already has a [${version}] section`)
const marker = "## [Unreleased]\n"
if (!changelog.includes(marker)) fail("CHANGELOG has no '## [Unreleased]' header")
const freshUnreleased =
  "## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n### Security\n\n" +
  `## [${version}] - ${date}\n`
const nextChangelog = changelog.replace(marker, freshUnreleased)

// ---- 2. whatsNew.ts ------------------------------------------------------
const whatsNew = readFileSync(WHATS_NEW, "utf8")
if (whatsNew.includes(`version: "${version}"`)) fail(`whatsNew.ts already has a "${version}" entry`)
const anchor = "export const WHATS_NEW: WhatsNewEntry[] = [\n"
if (!whatsNew.includes(anchor)) fail("whatsNew.ts has no WHATS_NEW array anchor")
const entry =
  "  {\n" +
  `    version: ${JSON.stringify(version)},\n` +
  `    date: ${JSON.stringify(date)},\n` +
  "    highlights: [\n" +
  highlights.map((h) => `      ${JSON.stringify(h)},\n`).join("") +
  "    ],\n" +
  "  },\n"
const nextWhatsNew = whatsNew.replace(anchor, anchor + entry)

// ---- 3. whatsNew.test.ts -------------------------------------------------
const test = readFileSync(WHATS_NEW_TEST, "utf8")
const testRe = /expect\(WHATS_NEW\[0\]\.version\)\.toBe\("v\d+\.\d+\.\d+"\)/
if (!testRe.test(test)) fail("whatsNew.test.ts has no WHATS_NEW[0].version assertion to bump")
const nextTest = test.replace(testRe, `expect(WHATS_NEW[0].version).toBe("${version}")`)

// ---- apply / report ------------------------------------------------------
if (write) {
  writeFileSync(CHANGELOG, nextChangelog)
  writeFileSync(WHATS_NEW, nextWhatsNew)
  writeFileSync(WHATS_NEW_TEST, nextTest)
  console.log(`✓ wrote release ${version} (${date}) — ${highlights.length} highlight(s)`)
  console.log("  edited: CHANGELOG.md, src/lib/whatsNew.ts, __tests__/lib/whatsNew.test.ts")
} else {
  console.log(`DRY RUN — release ${version} (${date}), ${highlights.length} highlight(s). Pass --write to apply.\n`)
  console.log("whatsNew.ts new entry:")
  console.log(entry)
  console.log("CHANGELOG.md new headers:")
  console.log(freshUnreleased)
  console.log(`whatsNew.test.ts assertion → toBe("${version}")`)
}
