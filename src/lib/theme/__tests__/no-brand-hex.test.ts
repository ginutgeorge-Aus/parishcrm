/** @jest-environment node */
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"

// Enforced artifact for the OSS de-brand (Phase 2 PR-B): brand colours must flow
// from THEME_* env via src/lib/theme/palette.ts (server) or the globals.css
// tokens (CSS) — never re-hardcoded into a PDF/email/print/component. A raw brand
// hex anywhere else means a new render site skipped the palette; this test fails
// so the grep gate can't silently regress. Allowed homes: palette.ts (the
// defaults), globals.css (the CSS token defaults), and this test's own fixtures.
const BRAND_HEX = /#1e293b|#c8a24a|#1e3a5f|#d9a441/i

const SRC = join(__dirname, "..", "..", "..") // src/
const ALLOWED = [
  join("lib", "theme", "palette.ts"),
  join("app", "globals.css"),
  join("lib", "theme", "__tests__"), // test fixtures reference the hex deliberately
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|css)$/.test(entry)) out.push(full)
  }
  return out
}

it("no raw brand hex outside palette.ts / globals.css (OSS de-brand gate)", () => {
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    if (ALLOWED.some((a) => file.includes(a))) continue
    if (BRAND_HEX.test(readFileSync(file, "utf8"))) offenders.push(file.slice(SRC.length + 1))
  }
  expect(offenders).toEqual([])
})
