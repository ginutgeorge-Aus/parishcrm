/** @jest-environment node */
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findDestructiveStatements, run, stripCommentsAndStrings } from "../../scripts/check-migration-safety"

/**
 * Rule names flagged for a SQL snippet.
 * @param sql migration SQL
 * @returns the rule of each finding, in order
 */
const rules = (sql: string) => findDestructiveStatements(sql).map((f) => f.rule)

describe("findDestructiveStatements", () => {
  it.each([
    ['ALTER TABLE "Person" DROP COLUMN "nickname";', "DROP"],
    ['DROP TABLE "Legacy";', "DROP"],
    ['DROP INDEX "Person_email_key";', "DROP"],
    ['ALTER TABLE "Event" DROP CONSTRAINT "Event_slug_check";', "DROP"],
    ['ALTER TABLE "Person" RENAME COLUMN "a" TO "b";', "RENAME"],
    ['ALTER TABLE "Person" RENAME TO "Member";', "RENAME"],
    ['ALTER TABLE "Event" ALTER COLUMN "slug" SET NOT NULL;', "SET NOT NULL without DEFAULT"],
    ['ALTER TABLE "Event" ADD COLUMN "kind" TEXT NOT NULL;', "ADD COLUMN NOT NULL without DEFAULT"],
    ['ALTER TABLE IF EXISTS ONLY "Event" ADD COLUMN "z" TEXT NOT NULL;', "ADD COLUMN NOT NULL without DEFAULT"],
    ['ALTER TABLE "T" ALTER COLUMN "c" TYPE INTEGER;', "column TYPE change"],
    ['ALTER TABLE "T" ALTER COLUMN "c" SET DATA TYPE INTEGER;', "column TYPE change"],
    ['TRUNCATE "T";', "TRUNCATE"],
    ['DELETE FROM "T" WHERE "x" = 1;', "DELETE"],
    ['ALTER TABLE "T" ALTER COLUMN "a" SET DEFAULT 0, ALTER COLUMN "b" SET NOT NULL;', "SET NOT NULL without DEFAULT"],
    ['ALTER TABLE "T" ALTER COLUMN "a" DROP DEFAULT;', "DROP"],
    ["-- don't drop yet\nDROP TABLE \"X\";\n-- it's fine", "DROP"],
    ["SELECT '--'; DROP TABLE \"X\";", "DROP"],
    ["DO $$ BEGIN ALTER TABLE \"T\" DROP COLUMN \"c\"; END $$;", "DROP"],
    // escape-string quote must not swallow the DROP after it
    ["SELECT E'it\\'s';\nDROP TABLE \"X\";\nSELECT 'tail';", "DROP"],
    // semicolon / comma inside quoted identifiers
    ['ALTER TABLE "T;archive" ADD COLUMN "c" TEXT NOT NULL;', "ADD COLUMN NOT NULL without DEFAULT"],
    ['ALTER TABLE "T" ADD COLUMN "x, ALTER COLUMN y SET DEFAULT 0" TEXT, ALTER COLUMN y SET NOT NULL;', "SET NOT NULL without DEFAULT"],
    // identifiers with `$` and doubled quotes
    ['ALTER TABLE "T" ALTER COLUMN amount$usd TYPE INTEGER;', "column TYPE change"],
    ['ALTER TABLE "T" ALTER COLUMN "a""b" SET NOT NULL;', "SET NOT NULL without DEFAULT"],
    // quoted case is significant
    ['ALTER TABLE "T" ALTER COLUMN "A" SET DEFAULT 0, ALTER COLUMN "a" SET NOT NULL;', "SET NOT NULL without DEFAULT"],
    // a quoted name is not the DEFAULT keyword
    ['ALTER TABLE "T" ADD COLUMN "default" TEXT NOT NULL;', "ADD COLUMN NOT NULL without DEFAULT"],
    // ALTER TABLE rules apply inside DO blocks
    ['DO $$ BEGIN ALTER TABLE "T" ALTER COLUMN "c" TYPE INTEGER; END $$;', "column TYPE change"],
    ['DO $$ BEGIN ALTER TABLE "T" ALTER COLUMN "c" SET NOT NULL; END $$;', "SET NOT NULL without DEFAULT"],
    ['DO $$ BEGIN ALTER TABLE "T" ADD COLUMN "c" TEXT NOT NULL; END $$;', "ADD COLUMN NOT NULL without DEFAULT"],
  ])("flags %s", (sql, rule) => {
    expect(rules(sql)).toEqual([rule])
  })

  it.each([
    ['ALTER TABLE "Event" ALTER COLUMN "slug" DROP NOT NULL;'],
    ['ALTER TABLE "Event" ADD COLUMN "note" TEXT;'],
    ['ALTER TABLE "Event" ADD COLUMN "kind" TEXT NOT NULL DEFAULT \'x\';'],
    ['ALTER TABLE "Event" ALTER COLUMN "n" SET DEFAULT 0, ALTER COLUMN "n" SET NOT NULL;'],
    ['ALTER TABLE "Event" ADD CONSTRAINT "Event_fk" FOREIGN KEY ("a") REFERENCES "B"("id") ON DELETE RESTRICT;'],
    ['CREATE TABLE "New" ("id" SERIAL NOT NULL, CONSTRAINT "New_pkey" PRIMARY KEY ("id"));'],
    ["-- DropIndex\n-- rename the old column later\nCREATE INDEX \"i\" ON \"T\"(\"c\");"],
    ["/* DROP TABLE x; */ SELECT 1;"],
    ['ALTER TABLE "T" ADD COLUMN "id2" SERIAL NOT NULL;'],
    ['ALTER TABLE "T" ADD COLUMN "id3" INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY;'],
    ['ALTER TABLE "T" ADD CHECK ("x" IS NOT NULL);'],
    ['ALTER TABLE "T" ALTER COLUMN "c" SET DEFAULT 0;\nALTER TABLE "T" ADD COLUMN "d" TEXT;'],
    ["DO $$ BEGIN RAISE EXCEPTION 'Archive or rename the extras, then DROP nothing'; END $$;"],
  ])("allows %s", (sql) => {
    expect(rules(sql)).toEqual([])
  })

  it("flags a constraint drop that no later add restores", () => {
    const fk = 'ALTER TABLE "C" ADD CONSTRAINT "C_fk" FOREIGN KEY ("a") REFERENCES "B"("id");'
    const drop = 'ALTER TABLE "C" DROP CONSTRAINT "C_fk";'
    expect(rules(`${drop}\n${fk}\n${drop}`)).toEqual(["DROP"])
    expect(rules(`${fk}\n${drop}`)).toEqual(["DROP"])
  })

  it("allows a foreign key dropped and re-added under the same name", () => {
    const sql =
      'ALTER TABLE "C" DROP CONSTRAINT "C_eventId_fkey";\n' +
      'ALTER TABLE "C" ADD CONSTRAINT "C_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT;'
    expect(rules(sql)).toEqual([])
  })

  it("still flags a re-added constraint statement that also drops a column", () => {
    const sql =
      'ALTER TABLE "C" DROP CONSTRAINT "C_fk", DROP COLUMN "old";\n' +
      'ALTER TABLE "C" ADD CONSTRAINT "C_fk" FOREIGN KEY ("a") REFERENCES "B"("id");'
    expect(rules(sql)).toEqual(["DROP"])
  })

  it("flags a constraint dropped on one table and re-added on another", () => {
    const sql =
      'ALTER TABLE "A" DROP CONSTRAINT "x_fk";\n' +
      'ALTER TABLE "B" ADD CONSTRAINT "x_fk" FOREIGN KEY ("a") REFERENCES "C"("id");'
    expect(rules(sql)).toEqual(["DROP"])
  })

  it("flags a non-foreign-key constraint re-added under the same name", () => {
    const sql = 'ALTER TABLE "A" DROP CONSTRAINT "x_chk";\nALTER TABLE "A" ADD CONSTRAINT "x_chk" CHECK (true);'
    expect(rules(sql)).toEqual(["DROP"])
  })

  it("judges each added column on its own DEFAULT", () => {
    expect(rules('ALTER TABLE "E" ADD COLUMN "a" TEXT NOT NULL, ADD COLUMN "b" INTEGER DEFAULT 0;')).toEqual([
      "ADD COLUMN NOT NULL without DEFAULT",
    ])
  })
})

describe("stripCommentsAndStrings", () => {
  it("empties string literals including escaped quotes", () => {
    expect(stripCommentsAndStrings("SELECT 'it''s DROP';")).toBe("SELECT '';")
  })
})

describe("run", () => {
  let log: jest.SpyInstance
  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => log.mockRestore())

  /**
   * Writes SQL to a temp migration file.
   * @param sql file contents
   * @returns the file path
   */
  const file = (sql: string) => {
    const p = join(mkdtempSync(join(tmpdir(), "mig-")), "migration.sql")
    writeFileSync(p, sql)
    return p
  }

  it("fails on a destructive migration", () => {
    expect(run([file('DROP TABLE "X";')])).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("::error file="))
  })

  it("warns but passes with --allow (destructive-migration label)", () => {
    expect(run(["--allow", file('DROP TABLE "X";')])).toBe(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("::warning file="))
  })

  it("passes an expand-only migration and no files", () => {
    expect(run([file('ALTER TABLE "X" ADD COLUMN "y" TEXT;')])).toBe(0)
    expect(run([])).toBe(0)
  })
})
