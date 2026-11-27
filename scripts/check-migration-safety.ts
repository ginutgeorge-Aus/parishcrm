/**
 * Migration safety lint (AUD-7-03 d). Production runs `prisma migrate deploy`
 * before the new revision takes traffic, so the old code keeps serving against
 * the migrated schema for a while and the DB is never auto-rolled-back. New
 * migrations must therefore be expand-only. This flags statements that break
 * old code or lose data: DROP (except `DROP NOT NULL`, which only relaxes, and
 * a foreign key re-added under the same name on the same table), RENAME, a
 * column TYPE change, TRUNCATE, DELETE FROM, `SET NOT NULL` without a
 * `SET DEFAULT` on the same column, and `ADD COLUMN ... NOT NULL` without a
 * DEFAULT (SERIAL and identity columns count as having one).
 *
 * Usage: node scripts/check-migration-safety.ts [--allow] <migration.sql>...
 * Exits 1 on any finding unless `--allow` (the PR carries the
 * `destructive-migration` label), which reports them as warnings only.
 */
import { readFileSync } from "node:fs"

export type Finding = { rule: string; statement: string }

/**
 * Removes SQL comments and single-quoted string literals so prose such as
 * `-- DropIndex` headers or `'... rename the extras'` messages never match.
 * One left-to-right pass, so an apostrophe inside a comment (`-- don't`) or
 * `--` inside a string cannot open a fake token that hides real SQL.
 * @param sql raw migration SQL
 * @returns SQL with comments removed and string literals emptied to `''`
 */
export function stripCommentsAndStrings(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*|'(?:[^']|'')*'/g, (m) => (m.startsWith("'") ? "''" : " "))
}

/**
 * Splits SQL into whitespace-normalised statements on `;`.
 * @param sql SQL already passed through stripCommentsAndStrings
 * @returns non-empty statements, each on one line
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0)
}

type AlterTable = { table: string; clauses: string[] }

/**
 * Parses an `ALTER TABLE [IF EXISTS] [ONLY] <name> <clause>, <clause>...` statement.
 * @param statement one normalised statement
 * @returns the lower-cased table name and its clauses, or null for any other statement
 */
function parseAlterTable(statement: string): AlterTable | null {
  const m = /^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?("[^"]+"(?:\."[^"]+")?|\S+) (.*)$/i.exec(statement)
  if (!m) return null
  return { table: m[1].toLowerCase(), clauses: m[2].split(/,\s*(?=(?:ADD|ALTER|DROP|RENAME|VALIDATE)\b)/i) }
}

/** Matches an identifier: quoted or bare. */
const IDENT = String.raw`("[^"]+"|\w+)`

/**
 * Collects `table|constraint` keys for every foreign key the file adds, so a
 * same-named drop on the same table reads as a re-definition, not a loss.
 * @param statements normalised statements of one file
 * @returns set of lower-cased `table|constraint` keys
 */
function readdedForeignKeys(statements: string[]): Set<string> {
  const keys = new Set<string>()
  for (const s of statements) {
    const alter = parseAlterTable(s)
    for (const c of alter?.clauses ?? []) {
      const m = new RegExp(String.raw`^ADD CONSTRAINT ${IDENT} FOREIGN KEY\b`, "i").exec(c)
      if (m) keys.add(`${alter!.table}|${m[1].toLowerCase()}`)
    }
  }
  return keys
}

/**
 * Lists the expand-only violations in one ALTER TABLE statement.
 * @param alter parsed statement
 * @param fks foreign keys the same file re-adds (readdedForeignKeys)
 * @returns the rule names broken, in clause order
 */
function alterTableRules(alter: AlterTable, fks: Set<string>): string[] {
  const rules: string[] = []
  const defaults = new Set<string>()
  for (const c of alter.clauses) {
    const m = new RegExp(String.raw`^ALTER (?:COLUMN )?${IDENT} SET DEFAULT\b`, "i").exec(c)
    if (m) defaults.add(m[1].toLowerCase())
  }
  for (const c of alter.clauses) {
    const dropConstraint = new RegExp(String.raw`^DROP CONSTRAINT (?:IF EXISTS )?${IDENT}`, "i").exec(c)
    if (dropConstraint) {
      if (!fks.has(`${alter.table}|${dropConstraint[1].toLowerCase()}`)) rules.push("DROP")
    } else if (/\bDROP\s+(?!NOT\s+NULL\b)/i.test(c)) {
      rules.push("DROP")
    }
    if (/\bRENAME\b/i.test(c)) rules.push("RENAME")
    if (new RegExp(String.raw`^ALTER (?:COLUMN )?${IDENT} (?:SET DATA )?TYPE\b`, "i").test(c)) rules.push("column TYPE change")
    const setNotNull = new RegExp(String.raw`^ALTER (?:COLUMN )?${IDENT} SET NOT NULL\b`, "i").exec(c)
    if (setNotNull && !defaults.has(setNotNull[1].toLowerCase())) rules.push("SET NOT NULL without DEFAULT")
    const isAddColumn = /^ADD (?!(?:CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)\b)/i.test(c)
    const hasImplicitDefault = /\b(?:DEFAULT|(?:SMALL|BIG)?SERIAL|GENERATED)\b/i.test(c)
    if (isAddColumn && /\bNOT NULL\b/i.test(c) && !hasImplicitDefault) rules.push("ADD COLUMN NOT NULL without DEFAULT")
  }
  return [...new Set(rules)]
}

/**
 * Lists the expand-only violations in one migration file's SQL.
 * @param sql raw migration SQL
 * @returns one finding per violating statement and rule
 */
export function findDestructiveStatements(sql: string): Finding[] {
  const statements = splitStatements(stripCommentsAndStrings(sql))
  const fks = readdedForeignKeys(statements)
  const findings: Finding[] = []
  for (const statement of statements) {
    const alter = parseAlterTable(statement)
    const rules: string[] = []
    if (alter) {
      rules.push(...alterTableRules(alter, fks))
    } else {
      // Anywhere in the statement, so DROP/DELETE inside a DO $$ ... $$ block still counts.
      if (/\bDROP\s+(?!NOT\s+NULL\b)/i.test(statement)) rules.push("DROP")
      if (/\bRENAME\b/i.test(statement)) rules.push("RENAME")
      if (/\bTRUNCATE\b/i.test(statement)) rules.push("TRUNCATE")
      if (/\bDELETE\s+FROM\b/i.test(statement)) rules.push("DELETE")
    }
    for (const rule of rules) findings.push({ rule, statement })
  }
  return findings
}

/**
 * CLI entry: lints each file given on the command line.
 * @param argv arguments after the script path
 * @returns process exit code (1 when a finding blocks)
 */
export function run(argv: string[]): number {
  const allow = argv.includes("--allow")
  const files = argv.filter((a) => a !== "--allow")
  let total = 0
  for (const file of files) {
    for (const f of findDestructiveStatements(readFileSync(file, "utf8"))) {
      total++
      const level = allow ? "warning" : "error"
      console.log(`::${level} file=${file}::${f.rule}: ${f.statement}`)
    }
  }
  if (total === 0) {
    console.log(`Checked ${files.length} new or edited migration file(s): expand-only.`)
    return 0
  }
  if (allow) {
    console.log(`${total} destructive statement(s) allowed by the destructive-migration label.`)
    return 0
  }
  console.log(
    `${total} destructive statement(s). Make the migration expand-only (add, backfill, switch code, drop in a later release), ` +
      "or add the destructive-migration label once a reviewer has checked the deploy order and backup.",
  )
  return 1
}

if (process.env.NODE_ENV !== "test") {
  process.exitCode = run(process.argv.slice(2))
}
