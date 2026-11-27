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

/** A double-quoted identifier, `""` being an escaped quote. */
const QUOTED = String.raw`"(?:[^"]|"")+"`
/** A PostgreSQL identifier: quoted, or bare (letters, digits, `_`, `$`). */
const IDENT_SRC = String.raw`(?:${QUOTED}|[A-Za-z_][\w$]*)`
const IDENT = `(${IDENT_SRC})`

/**
 * Removes SQL comments and string literals so prose such as `-- DropIndex`
 * headers or `'... rename the extras'` messages never match. One
 * left-to-right pass, so an apostrophe inside a comment (`-- don't`), a quote
 * inside a quoted identifier, or `--` inside a string cannot open a fake token
 * that hides real SQL. `E'...'` strings honour backslash escapes (`\'`);
 * plain strings only the doubled `''`.
 * @param sql raw migration SQL
 * @returns SQL with comments removed and string literals emptied to `''`
 */
export function stripCommentsAndStrings(sql: string): string {
  const token = new RegExp(
    String.raw`\/\*[\s\S]*?\*\/|--[^\n]*|${QUOTED}|(?<![\w$])[eE]'(?:[^'\\]|\\[\s\S]|'')*'|'(?:[^']|'')*'`,
    "g",
  )
  return sql.replace(token, (m) => {
    if (m.startsWith('"')) return m
    return m.startsWith("/*") || m.startsWith("--") ? " " : "''"
  })
}

/**
 * Splits text on a separator that sits outside double-quoted identifiers.
 * @param text SQL text
 * @param isSeparator given the text from an unquoted position, true when a split happens there
 * @returns the pieces (separator excluded)
 */
function splitOutsideQuotes(text: string, isSeparator: (rest: string) => boolean): string[] {
  const parts: string[] = []
  let start = 0
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') inQuote = !inQuote // a doubled `""` toggles twice
    else if (!inQuote && isSeparator(text.slice(i))) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * Splits SQL into whitespace-normalised statements on `;` outside quoted identifiers.
 * @param sql SQL already passed through stripCommentsAndStrings
 * @returns non-empty statements, each on one line
 */
function splitStatements(sql: string): string[] {
  return splitOutsideQuotes(sql, (r) => r[0] === ";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0)
}

/**
 * Normalises one identifier the way PostgreSQL does: bare names fold to lower
 * case, quoted names keep their case (`""` unescaped).
 * @param ident bare or quoted identifier
 * @returns the canonical name
 */
function canon(ident: string): string {
  return ident.startsWith('"') ? ident.slice(1, -1).replace(/""/g, '"') : ident.toLowerCase()
}

/**
 * Replaces quoted identifiers with `""` so a name like `"drop it"` or
 * `"default"` is never mistaken for a keyword.
 * @param text SQL fragment
 * @returns the fragment with every quoted identifier blanked
 */
function blankQuoted(text: string): string {
  return text.replace(new RegExp(QUOTED, "g"), '""')
}

type AlterTable = { table: string; clauses: string[] }

/**
 * Parses an `ALTER TABLE [IF EXISTS] [ONLY] <name> <clause>, <clause>...`
 * statement, also when it sits inside a `DO $$ ... $$` block fragment.
 * @param statement one normalised statement
 * @returns the canonical table name and its clauses, or null for any other statement
 */
function parseAlterTable(statement: string): AlterTable | null {
  const m = new RegExp(String.raw`(?:^|\$\w*\$\s*(?:BEGIN\s+)?|\b(?:BEGIN|THEN|ELSE)\s+)ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(${IDENT_SRC}(?:\.${IDENT_SRC})?) (.*)$`, "i").exec(statement)
  if (!m) return null
  const table = m[1]
    .split(new RegExp(String.raw`\.(?=${IDENT_SRC}$)`))
    .map(canon)
    .join(".")
  const clauses = splitOutsideQuotes(m[2], (r) => /^,\s*(?:ADD|ALTER|DROP|RENAME|VALIDATE)\b/i.test(r)).map((c) => c.trim())
  return { table, clauses }
}

type ConstraintEvent = { id: string; type: "add" | "drop"; key: string }

/**
 * Lists, in file order, every foreign key added and every constraint dropped.
 * @param alters parsed ALTER TABLE statements (null for other statements)
 * @returns events with a stable `statement:clause` id
 */
function constraintEvents(alters: (AlterTable | null)[]): ConstraintEvent[] {
  const events: ConstraintEvent[] = []
  alters.forEach((alter, si) => {
    alter?.clauses.forEach((c, ci) => {
      const add = new RegExp(String.raw`^ADD CONSTRAINT ${IDENT} FOREIGN KEY\b`, "i").exec(c)
      if (add) events.push({ id: `${si}:${ci}`, type: "add", key: `${alter.table}|${canon(add[1])}` })
      const drop = new RegExp(String.raw`^DROP CONSTRAINT (?:IF EXISTS )?${IDENT}`, "i").exec(c)
      if (drop) events.push({ id: `${si}:${ci}`, type: "drop", key: `${alter.table}|${canon(drop[1])}` })
    })
  })
  return events
}

/**
 * Ids of constraint drops that a later foreign-key add of the same name
 * restores, so they read as a re-definition rather than a loss. A drop with no
 * add after it (even if an earlier add exists) is not exempt.
 * @param events constraintEvents output, in file order
 * @returns the exempt `statement:clause` ids
 */
function restoredDrops(events: ConstraintEvent[]): Set<string> {
  const exempt = new Set<string>()
  events.forEach((e, i) => {
    if (e.type === "drop" && events.slice(i + 1).some((l) => l.type === "add" && l.key === e.key)) exempt.add(e.id)
  })
  return exempt
}

/**
 * Lists the expand-only violations in one ALTER TABLE statement.
 * @param alter parsed statement
 * @param si statement index in the file
 * @param exempt restoredDrops ids
 * @returns the rule names broken, in clause order
 */
function alterTableRules(alter: AlterTable, si: number, exempt: Set<string>): string[] {
  const rules: string[] = []
  const defaults = new Set<string>()
  for (const c of alter.clauses) {
    const m = new RegExp(String.raw`^ALTER (?:COLUMN )?${IDENT} SET DEFAULT\b`, "i").exec(c)
    if (m) defaults.add(canon(m[1]))
  }
  alter.clauses.forEach((c, ci) => {
    const bare = blankQuoted(c)
    if (/^DROP CONSTRAINT\b/i.test(c)) {
      if (!exempt.has(`${si}:${ci}`)) rules.push("DROP")
    } else if (/\bDROP\s+(?!NOT\s+NULL\b)/i.test(bare)) {
      rules.push("DROP")
    }
    if (/\bRENAME\b/i.test(bare)) rules.push("RENAME")
    if (new RegExp(String.raw`^ALTER (?:COLUMN )?${IDENT} (?:SET DATA )?TYPE\b`, "i").test(c)) rules.push("column TYPE change")
    const setNotNull = new RegExp(String.raw`^ALTER (?:COLUMN )?${IDENT} SET NOT NULL\b`, "i").exec(c)
    if (setNotNull && !defaults.has(canon(setNotNull[1]))) rules.push("SET NOT NULL without DEFAULT")
    const add = new RegExp(String.raw`^ADD (?:COLUMN )?(?:IF NOT EXISTS )?${IDENT} (.*)$`, "i").exec(c)
    const isAddColumn = add && !/^ADD (?:CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)\b/i.test(c)
    if (isAddColumn) {
      // Judge only the type and constraints after the column name, quoted names blanked.
      const rest = blankQuoted(add[2])
      const hasImplicitDefault = /\b(?:DEFAULT|(?:SMALL|BIG)?SERIAL|GENERATED)\b/i.test(rest)
      if (/\bNOT NULL\b/i.test(rest) && !hasImplicitDefault) rules.push("ADD COLUMN NOT NULL without DEFAULT")
    }
  })
  return [...new Set(rules)]
}

/**
 * Lists the expand-only violations in one migration file's SQL.
 * @param sql raw migration SQL
 * @returns one finding per violating statement and rule
 */
export function findDestructiveStatements(sql: string): Finding[] {
  const statements = splitStatements(stripCommentsAndStrings(sql))
  const alters = statements.map(parseAlterTable)
  const exempt = restoredDrops(constraintEvents(alters))
  const findings: Finding[] = []
  statements.forEach((statement, si) => {
    const alter = alters[si]
    const rules: string[] = []
    if (alter) {
      rules.push(...alterTableRules(alter, si, exempt))
    } else {
      // Anywhere in the statement, so DROP/DELETE inside a DO $$ ... $$ block still counts.
      const bare = blankQuoted(statement)
      if (/\bDROP\s+(?!NOT\s+NULL\b)/i.test(bare)) rules.push("DROP")
      if (/\bRENAME\b/i.test(bare)) rules.push("RENAME")
      if (/\bTRUNCATE\b/i.test(bare)) rules.push("TRUNCATE")
      if (/\bDELETE\s+FROM\b/i.test(bare)) rules.push("DELETE")
    }
    for (const rule of rules) findings.push({ rule, statement })
  })
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
