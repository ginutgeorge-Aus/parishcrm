/** @jest-environment node */
// Phone-width (375px) overflow guard, improvement idea 125 (audit AUD-8).
//
// The recurring defect: a page header row written as
// `flex items-center justify-between` with a heading and one or more buttons
// and no wrap or stack rule. At 375px the buttons push the row wider than the
// viewport and the whole page scrolls sideways.
//
// The repo has no browser CI (Playwright is a devDependency used only by
// scripts/perf, and a real run needs a built app, a database and a login), so
// this is a static scan of className strings instead. It is a ratchet: the
// rows that already exist are listed in BASELINE by file with a count. A new
// offending row, or a new file with one, fails. Fixing a row without lowering
// its baseline count also fails, so the list only shrinks.
//
// Limits: the baseline is a per-file count, so fixing one row and adding another
// in the same file cancels out; a `sm:flex-row` row with no base `flex-col` is
// flagged; only single-line `className="..."` literals are checked (not `cn()`,
// template strings or classes split over lines); the rule fires only when a
// heading (h1/h2/CardTitle) sits within 5 lines below the row; it cannot see
// content width, tables or fixed-width children. It is a tripwire for the known
// class, not a layout test.

import * as fs from "fs"
import * as path from "path"

const SRC = path.join(__dirname, "../../src")

// Existing offenders (file relative to src/ -> count). Fix the row, then lower
// or delete the entry. Do not add entries for new code: wrap or stack the row.
const BASELINE: Record<string, number> = {
  "app/(dashboard)/accounting/accounts/groups/page.tsx": 1,
  "app/(dashboard)/accounting/accounts/page.tsx": 1,
  "app/(dashboard)/accounting/dues/page.tsx": 1,
  "app/(dashboard)/accounting/page.tsx": 1,
  "app/(dashboard)/accounting/petty-cash/service-types/page.tsx": 1,
  "app/(dashboard)/accounting/petty-cash/sessions/[id]/page.tsx": 1,
  "app/(dashboard)/accounting/reconciliation/page.tsx": 2,
  "app/(dashboard)/accounting/reports/balance-sheet/page.tsx": 1,
  "app/(dashboard)/accounting/reports/budget-vs-actual/page.tsx": 1,
  "app/(dashboard)/accounting/reports/cash-flow/page.tsx": 1,
  "app/(dashboard)/accounting/reports/funds/page.tsx": 1,
  "app/(dashboard)/accounting/reports/giving-summary/page.tsx": 1,
  "app/(dashboard)/accounting/reports/trial-balance/page.tsx": 1,
  "app/(dashboard)/accounting/settings/funds/page.tsx": 1,
  "app/(dashboard)/accounting/transactions/page.tsx": 1,
  "app/(dashboard)/events/[id]/fundraiser/page.tsx": 1,
  "app/(dashboard)/events/page.tsx": 1,
  "app/(dashboard)/families/[id]/giving/page.tsx": 1,
  "app/(dashboard)/families/[id]/page.tsx": 1,
  "app/(dashboard)/families/archived/page.tsx": 1,
  "app/(dashboard)/memberships/[id]/page.tsx": 2,
  "app/(dashboard)/people/page.tsx": 1,
  "app/(dashboard)/users/page.tsx": 1,
  "components/family-update/FamilyUpdateForm.tsx": 1,
  "components/import/ImportClient.tsx": 1,
  "components/people/AnniversariesClient.tsx": 1,
  "components/people/BirthdaysClient.tsx": 1,
  "components/sacraments/PersonSacramentsCard.tsx": 1,
}

const HEADING = /<h[12][\s>]|<CardTitle[\s>]/

/**
 * True when a class list is a non-wrapping, non-stacking space-between row
 * that would overflow a 375px viewport once it holds a heading plus buttons.
 * @param classes - the className string split on whitespace
 */
function isOverflowProneRow(classes: string[]): boolean {
  if (!classes.includes("flex") || !classes.includes("justify-between")) return false
  if (classes.includes("hidden")) return false
  return !classes.some((c) => /^(flex-wrap|flex-col)$|^(sm|md|lg|xl):flex-wrap$/.test(c))
}

/**
 * Counts overflow-prone heading rows in one TSX source text.
 * @param source - file contents
 */
function countOverflowRows(source: string): number {
  const lines = source.split("\n")
  let count = 0
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/className="([^"]*)"/g)) {
      if (!isOverflowProneRow(m[1].split(/\s+/))) continue
      if (HEADING.test(lines.slice(i + 1, i + 6).join(" "))) count++
    }
  })
  return count
}

/**
 * Lists non-test, non-generated TSX files under `dir`.
 * @param dir - directory to walk
 */
function listTsx(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      const skip = e.name === "__tests__" || p === path.join(SRC, "components/ui") || p === path.join(SRC, "lib/generated")
      return skip ? [] : listTsx(p)
    }
    return e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx") ? [p] : []
  })
}

describe("countOverflowRows", () => {
  it("flags an unwrapped heading + button row", () => {
    const src = `<div className="flex items-center justify-between mb-6">\n<h1>Title</h1>\n<Button/>\n</div>`
    expect(countOverflowRows(src)).toBe(1)
  })

  it.each([
    "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
    "flex flex-wrap items-center justify-between gap-2",
    "flex hidden justify-between",
    "flex items-center justify-between sm:flex-wrap",
  ])("ignores a safe row: %s", (cls) => {
    expect(countOverflowRows(`<div className="${cls}">\n<h1>T</h1>\n</div>`)).toBe(0)
  })

  it("ignores a row with no heading nearby", () => {
    expect(countOverflowRows(`<div className="flex justify-between">\n<span/>\n</div>`)).toBe(0)
  })
})

describe("phone overflow ratchet (375px)", () => {
  const found: Record<string, number> = {}
  for (const file of listTsx(SRC)) {
    const n = countOverflowRows(fs.readFileSync(file, "utf8"))
    if (n > 0) found[path.relative(SRC, file).split(path.sep).join("/")] = n
  }

  it("has no new overflow-prone header rows (wrap or stack them: flex-col sm:flex-row)", () => {
    const fresh = Object.entries(found).filter(([f, n]) => n > (BASELINE[f] ?? 0))
    expect(fresh).toEqual([])
  })

  it("has no stale baseline entries (lower or delete the entry once a row is fixed)", () => {
    const stale = Object.entries(BASELINE).filter(([f, n]) => (found[f] ?? 0) < n)
    expect(stale).toEqual([])
  })
})
